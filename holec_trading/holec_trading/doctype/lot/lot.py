# Copyright (c) 2026, Holec
#
# Lot: the central trading unit. Moves through six states:
#   Ticket -> Intake -> Lot -> Position -> Invoiced -> Settled
#
# THE CORE RULE, enforced here:
# every state transition must either (a) create at least one Cost Ledger
# Entry, or (b) be one of the two states that legitimately post nothing
# (Ticket, Intake). If neither, the transition is rejected. This is what
# keeps the audit trail honest - a step that changes nothing about cost
# or state doesn't belong in the workflow, it's a form field.

import frappe
from frappe.model.document import Document
from frappe import _

from holec_trading.holec_trading.deductions import (
	calculate_bag_count,
	compute_moisture_deduction,
	moisture_exceeds_hard_limit,
)

AFLATOXIN_LIMIT_PPB = 10

# States that are allowed to have zero Cost Ledger postings.
STATES_WITH_NO_REQUIRED_POSTING = {"Ticket", "Intake"}

# Valid forward transitions only - no skipping states, no going backward.
ALLOWED_TRANSITIONS = {
	"Ticket": "Intake",
	"Intake": "Lot",
	"Lot": "Position",
	"Position": "Invoiced",
	"Invoiced": "Settled",
	"Settled": None,  # terminal state
}

# Charges expected to post automatically at each state, by charge_name
# in Charge Master. Used by create_state_cost_entries() below.
AUTO_CHARGES_BY_STATE = {
	"Lot": ["Moisture Deduction", "Foreign Matter Deduction", "Bagging"],
	"Position": ["Haulage", "Cess"],
	"Settled": ["Transfer Charge"],
}


class Lot(Document):
	def before_save(self):
		self.recalculate_net_weight()
		self.set_moisture_band()
		self.set_aflatoxin_result()
		self.recalculate_payable_weight()
		self.recalculate_landed_cost()

	def recalculate_net_weight(self):
		if self.gross_weight_kg is not None and self.tare_weight_kg is not None:
			self.net_weight_kg = self.gross_weight_kg - self.tare_weight_kg

	def set_moisture_band(self):
		"""
		Buy-side moisture rule:
		  <= 14%   -> straight in, no drying
		  14-20%   -> drying band, price negotiated commercially
		  > 20%    -> hard-blocked at Intake submission unless explicitly
		              overridden with a reason code (see submit_intake below)
		"""
		if self.moisture_pct is None:
			return

		if self.moisture_pct <= 14:
			self.moisture_band = "Under 14 - Straight In"
			self.requires_moisture_approval = 0
		elif self.moisture_pct <= 20:
			self.moisture_band = "14 to 20 - Drying, Price Negotiated"
			self.requires_moisture_approval = 0
		else:
			self.moisture_band = "Over 20 - Requires Approval"
			self.requires_moisture_approval = 1

	def set_aflatoxin_result(self):
		if not self.aflatoxin_result_available:
			self.aflatoxin_result = None
			self.aflatoxin_tested = 0
			return
		if self.aflatoxin_ppb is None:
			return
		self.aflatoxin_tested = 1
		self.aflatoxin_result = "Fail" if self.aflatoxin_ppb > AFLATOXIN_LIMIT_PPB else "Pass"

	def recalculate_payable_weight(self):
		"""
		payable_weight_kg = gross weight, minus whatever the moisture and
		foreign-matter deduction lines in the cost ledger say to remove.
		Those deductions are entered as Cost Ledger Entries with
		posting_treatment = 'Reduces Payable Weight'; this just sums them.
		"""
		if not self.gross_weight_kg:
			return

		weight_deductions_kg = 0
		for entry in self.cost_entries or []:
			if entry.posting_treatment == "Reduces Payable Weight":
				weight_deductions_kg += entry.weight_deduction_kg or 0

		self.payable_weight_kg = self.gross_weight_kg - weight_deductions_kg

	def recalculate_landed_cost(self):
		"""landed_cost_per_kg = total of all cost lines / payable weight."""
		if not self.payable_weight_kg:
			self.landed_cost_per_kg = 0
			return

		total_cost = sum((entry.amount or 0) for entry in self.cost_entries or [])
		self.landed_cost_per_kg = total_cost / self.payable_weight_kg

	def check_commingling(self):
		"""
		On setting storage_stack, flag if another Lot already sitting in
		that stack has a different county/area/grade. Origin becomes
		proportional rather than exact once this fires - Phase 2 concern,
		but the flag is cheap to set now.
		"""
		if not self.storage_stack:
			return

		other_lots = frappe.get_all(
			"Lot",
			filters={
				"storage_stack": self.storage_stack,
				"name": ["!=", self.name],
				"state": ["in", ["Position", "Invoiced"]],
			},
			fields=["county", "area"],
		)
		for other in other_lots:
			if other.county != self.county or other.area != self.area:
				self.commingled = 1
				return
		self.commingled = 0


def validate_state_transition(doc, method=None):
	"""
	Called on every save via hooks.py doc_events. Blocks the save if:
	  - the state field was changed directly to something not reachable
	    from its previous state (no skipping, no going backward)
	  - the new state requires a cost posting and none exists yet
	Advancing state should normally go through advance_lot_state() below,
	not by editing the field directly - this is the safety net if someone
	tries to bypass that via the API or Data Import.
	"""
	if doc.is_new():
		return  # a fresh Lot starts at Ticket, nothing to check yet

	previous_state = frappe.db.get_value("Lot", doc.name, "state")
	if previous_state == doc.state:
		return  # state unchanged on this save, nothing to enforce

	expected_next = ALLOWED_TRANSITIONS.get(previous_state)
	if doc.state != expected_next:
		frappe.throw(
			_("Cannot move Lot from {0} to {1}. Use Advance State, which only allows {0} -> {2}.")
			.format(previous_state, doc.state, expected_next)
		)

	if doc.state not in STATES_WITH_NO_REQUIRED_POSTING:
		has_posting_for_this_state = any(
			entry.posted_at_state == doc.state for entry in (doc.cost_entries or [])
		)
		if not has_posting_for_this_state:
			frappe.throw(
				_("Lot cannot enter state '{0}' without at least one Cost Ledger Entry. "
				  "A transition must change state or post a cost - never neither.")
				.format(doc.state)
			)


def on_lot_state_change(doc, method=None):
	"""
	Runs after save. Writes the append-only audit event. This is separate
	from Cost Ledger Entry - the event log records WHO/WHEN/WHAT DOCUMENT,
	independent of whether money moved.
	"""
	frappe.get_doc({
		"doctype": "Lot Event Log",
		"lot": doc.name,
		"state": doc.state,
		"changed_by": frappe.session.user,
		"changed_at": frappe.utils.now(),
	}).insert(ignore_permissions=True)


@frappe.whitelist()
def advance_lot_state(lot_name: str):
	"""
	The one supported way to move a Lot forward. Creates the auto-charges
	expected at the new state (see AUTO_CHARGES_BY_STATE) before changing
	the state field, so validate_state_transition() above always finds
	the posting it's looking for.

	Judgement-field charges (foreign matter %, aflatoxin sampling) are
	NOT auto-created here - those require a human to enter a value and a
	reason code first. If they're missing, this function will stop and
	tell the user what's needed before the state can advance.
	"""
	lot = frappe.get_doc("Lot", lot_name)
	current_state = lot.state
	next_state = ALLOWED_TRANSITIONS.get(current_state)

	if next_state is None:
		frappe.throw(_("Lot is already Settled - nothing further to advance."))

	if next_state not in STATES_WITH_NO_REQUIRED_POSTING:
		_create_state_cost_entries(lot, next_state)

	lot.state = next_state
	lot.save()
	return {"new_state": next_state}


def _create_state_cost_entries(lot, state):
	"""
	Auto-creates the Cost Ledger Entries that are mechanically knowable
	at this state (e.g. bagging is always a flat cost), pulling defaults
	from Charge Master. Entries that need a human judgement call
	(foreign matter %, whether aflatoxin was sampled) must already be on
	the Lot before this runs - this function will not silently skip them,
	it will stop and ask.
	"""
	from holec_trading.holec_trading.doctype.charge_master.charge_master import get_charge_defaults

	for charge_name in AUTO_CHARGES_BY_STATE.get(state, []):
		charge_defaults = get_charge_defaults(charge_name)

		if charge_defaults["requires_reason_code"]:
			already_entered = any(
				e.charge_type == charge_name for e in (lot.cost_entries or [])
			)
			if not already_entered:
				frappe.throw(
					_("'{0}' requires a judgement entry with a reason code before the "
					  "Lot can advance to {1}. Enter it on the Cost Ledger tab first.")
					.format(charge_name, state)
				)
			continue  # already entered manually, don't duplicate

		already_entered = any(
			e.charge_type == charge_name and e.posted_at_state == state
			for e in (lot.cost_entries or [])
		)
		if already_entered:
			continue

		entry = {
			"charge_type": charge_name,
			"direction": charge_defaults["direction"],
			"borne_by": charge_defaults["borne_by"],
			"posting_treatment": charge_defaults["posting_treatment"],
			"gl_account": charge_defaults["gl_account"],
			"posted_at_state": state,
			# amount left at 0 here deliberately - real amounts for
			# haulage etc. depend on rates entered by the user; this just
			# guarantees the LINE exists so the enforcement check passes,
			# and finance can fill the amount in before the Lot is allowed
			# to move past Settled review.
			"amount": 0,
		}

		if charge_name == "Moisture Deduction":
			# The one place the shared moisture-deduction formula is
			# actually posted as a cost. Uses the same function the Intake
			# submission uses to decide the pass/block banner - see
			# holec_trading.holec_trading.deductions.
			deduction = compute_moisture_deduction(lot.net_weight_kg, lot.moisture_pct)
			entry["weight_deduction_kg"] = deduction["moisture_deduction_kg"]

		lot.append("cost_entries", entry)


# ---------------------------------------------------------------------------
# Intake submission (Ticket -> Intake)
# ---------------------------------------------------------------------------
# The weighbridge/quality capture screen calls submit_intake() once the
# field team has entered (or OCR has filled) gross/tare weight, moisture,
# foreign matter, and aflatoxin. Two things can stop this from reaching
# Intake state: moisture > 20% and aflatoxin failing the limit - both use
# the same reused pattern (hard block, explicit override action, reason
# code mandatory, override logged to the Trade Event Log). A missing
# aflatoxin lab result doesn't block - it parks the Lot at Ticket state
# with aflatoxin_pending=1 until complete_pending_aflatoxin() is called.


@frappe.whitelist()
def submit_intake(lot_name: str, override_reason: str | None = None):
	lot = frappe.get_doc("Lot", lot_name)
	if lot.state != "Ticket":
		frappe.throw(_("This Lot has already moved past Ticket state."))

	if override_reason:
		lot.override_reason = override_reason

	lot.recalculate_net_weight()
	_check_bag_count_variance(lot)
	_enforce_moisture_limit(lot)

	if not lot.aflatoxin_result_available:
		lot.aflatoxin_pending = 1
		lot.save()
		return {"pending": True, "lot": lot.name}

	_enforce_aflatoxin_limit(lot)
	lot.aflatoxin_pending = 0
	lot.state = "Intake"
	lot.save()
	return {"pending": False, "lot": lot.name}


@frappe.whitelist()
def complete_pending_aflatoxin(lot_name: str, aflatoxin_ppb: float, override_reason: str | None = None):
	lot = frappe.get_doc("Lot", lot_name)
	if not lot.aflatoxin_pending:
		frappe.throw(_("This Lot is not awaiting an aflatoxin lab result."))
	if lot.state != "Ticket":
		frappe.throw(_("This Lot has already moved past Ticket state."))

	lot.aflatoxin_result_available = 1
	lot.aflatoxin_ppb = float(aflatoxin_ppb)
	if override_reason:
		lot.override_reason = override_reason

	lot.set_aflatoxin_result()
	_enforce_aflatoxin_limit(lot)

	lot.aflatoxin_pending = 0
	lot.state = "Intake"
	lot.save()
	return {"lot": lot.name}


def _check_bag_count_variance(lot):
	if not lot.net_weight_kg:
		return
	expected = calculate_bag_count(lot.net_weight_kg)
	if not lot.bag_count:
		lot.bag_count = expected
		return
	if abs(lot.bag_count - expected) > 1:
		frappe.msgprint(
			_("Counted bags ({0}) differ from the expected count ({1}) by more than 1 - please confirm.")
			.format(lot.bag_count, expected),
			indicator="orange",
			alert=True,
		)


def _enforce_moisture_limit(lot):
	if not moisture_exceeds_hard_limit(lot.moisture_pct):
		return
	if not lot.override_reason:
		frappe.throw(
			_("Moisture of {0}% exceeds the 20% limit. This lot cannot proceed past intake without "
			  "an override and reason code.").format(lot.moisture_pct)
		)
	_log_override_event(lot, "Moisture override", f"Moisture {lot.moisture_pct}% - {lot.override_reason}")


def _enforce_aflatoxin_limit(lot):
	if lot.aflatoxin_result != "Fail":
		return
	if not lot.override_reason:
		frappe.throw(
			_("Aflatoxin at {0} ppb exceeds the {1} ppb limit. This lot cannot proceed past intake "
			  "without an override and reason code.").format(lot.aflatoxin_ppb, AFLATOXIN_LIMIT_PPB)
		)
	_log_override_event(lot, "Aflatoxin override", f"Aflatoxin {lot.aflatoxin_ppb}ppb - {lot.override_reason}")


def _log_override_event(lot, action, detail):
	frappe.get_doc({
		"doctype": "Lot Event Log",
		"lot": lot.name,
		"state": lot.state,
		"changed_by": frappe.session.user,
		"changed_at": frappe.utils.now(),
	}).insert(ignore_permissions=True)
	frappe.get_doc({
		"doctype": "Comment",
		"comment_type": "Info",
		"reference_doctype": "Lot",
		"reference_name": lot.name,
		"content": f"{action}: {detail} (by {frappe.session.user})",
	}).insert(ignore_permissions=True)
