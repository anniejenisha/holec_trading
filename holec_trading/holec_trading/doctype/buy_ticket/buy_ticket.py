# Copyright (c) 2026, Holec
#
# Buy Ticket: captures a trade before goods exist. Two roles create these
# on the same doctype - a Supplier (self-service, "Offered" status, not yet
# in the Lot lifecycle) and a Purchase User (either confirming an Offered
# ticket, or creating one directly for a phone-negotiated deal, which is
# the primary path and goes straight to "Ticket" status).
#
# Once status = "Ticket", a Lot exists for it (state=Ticket) and all
# further lifecycle progress is tracked on that Lot, not by changing this
# doctype's status any further.
#
# There is no Rate Card / reference-rate component in this scope - do not
# reintroduce a margin or reference-rate field here.

import frappe
from frappe import _
from frappe.model.document import Document


class BuyTicket(Document):
	def validate(self):
		validate_buy_ticket(self)

	def on_update(self):
		if self.status == "Ticket":
			create_lot_if_needed(self)


def validate_buy_ticket(doc, method=None):
	supplier_link = get_supplier_for_current_user()

	if supplier_link:
		# Supplier self-service: the record is theirs and theirs alone.
		# Never trust a client-supplied supplier/status for this role -
		# enforce both server-side regardless of what was posted.
		doc.supplier = supplier_link
		if doc.is_new():
			doc.status = "Offered"
		elif doc.status not in ("Offered", "Cancelled"):
			frappe.throw(_("Only a Purchase User can confirm or reject a ticket."))
	elif doc.is_new() and doc.status in (None, "", "Draft"):
		# Purchase User (or System Manager) creating directly: the primary
		# path, goes straight to Ticket status.
		doc.status = "Ticket"

	if not doc.quantity_kg or doc.quantity_kg <= 0:
		frappe.throw(_("Quantity offered must be greater than zero."))
	if not doc.negotiated_price or doc.negotiated_price <= 0:
		frappe.throw(_("Price offered must be greater than zero."))


def get_supplier_for_current_user() -> str | None:
	"""
	Resolves the logged-in user to their Supplier record, via a Contact
	that has this user linked and a Dynamic Link to a Supplier. Returns
	None for internal (Purchase User / System Manager) users.
	"""
	if "Supplier" not in frappe.get_roles():
		return None

	contact_name = frappe.db.get_value("Contact", {"user": frappe.session.user}, "name")
	if not contact_name:
		return None

	return frappe.db.get_value(
		"Dynamic Link",
		{"parenttype": "Contact", "parent": contact_name, "link_doctype": "Supplier"},
		"link_name",
	)


def create_lot_if_needed(ticket) -> str | None:
	"""Called whenever a ticket is saved with status=Ticket. Idempotent - only ever creates one Lot per ticket."""
	if frappe.db.exists("Lot", {"buy_ticket": ticket.name}):
		return None

	lot = frappe.get_doc({
		"doctype": "Lot",
		"buy_ticket": ticket.name,
		"supplier": ticket.supplier,
		"state": "Ticket",
	})
	lot.insert(ignore_permissions=True)
	return lot.name


@frappe.whitelist()
def confirm_ticket(ticket_name: str):
	"""Purchase User action: Offered -> Ticket. on_update then creates the Lot."""
	_require_purchase_role()
	ticket = frappe.get_doc("Buy Ticket", ticket_name)
	if ticket.status != "Offered":
		frappe.throw(_("Only Offered tickets can be confirmed."))

	ticket.status = "Ticket"
	ticket.save()
	return frappe.db.get_value("Lot", {"buy_ticket": ticket.name}, "name")


@frappe.whitelist()
def reject_ticket(ticket_name: str, reason: str | None = None):
	"""Purchase User action: Offered -> Cancelled. Never enters the Lot lifecycle."""
	_require_purchase_role()
	ticket = frappe.get_doc("Buy Ticket", ticket_name)
	if ticket.status != "Offered":
		frappe.throw(_("Only Offered tickets can be rejected."))

	ticket.status = "Cancelled"
	ticket.save()
	if reason:
		ticket.add_comment("Comment", _("Rejected: {0}").format(reason))


def _require_purchase_role():
	if not set(frappe.get_roles()) & {"Trading Officer", "System Manager"}:
		frappe.throw(_("Not permitted."), frappe.PermissionError)
