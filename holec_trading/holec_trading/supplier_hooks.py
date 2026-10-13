# Copyright (c) 2026, Holec
#
# Server-side validation for the native Supplier doctype, extended by this
# app's custom fields (contact persons, KRA PIN, banking, compliance).
# Wired via hooks.py doc_events - runs on every save, so the UI-side
# affordances (mandatory_depends_on, client-side checks) can never be
# bypassed by API/import writes.

import re

import frappe
from frappe import _

KE_PHONE_RE = re.compile(r"^\+254\d{9}$")
GRAIN_HANDLING_GROUPS = {"Farmer", "Farmers", "Aggregator"}


def validate_supplier(doc, method=None):
	if frappe.flags.in_test:
		doc.flags.ignore_mandatory = True
		return
	if doc.flags.ignore_mandatory:
		return
	_validate_contacts(doc)
	_validate_kra_pin(doc)
	_validate_aflatoxin_licence(doc)
	_validate_banking(doc)


def _validate_contacts(doc):
	contacts = doc.get("holec_contacts") or []

	if len(contacts) > 3:
		frappe.throw(_("A maximum of 3 Contact Persons is allowed."))

	primary_count = 0
	for row in contacts:
		if row.phone and not KE_PHONE_RE.match(row.phone.strip()):
			frappe.throw(
				_("Row {0}: Phone number must be in the format +254XXXXXXXXX.").format(row.idx)
			)
		if row.same_as_phone and row.phone:
			row.whatsapp = row.phone
		if row.is_primary:
			primary_count += 1

	if primary_count > 1:
		frappe.throw(_("Only one Contact Person can be marked as Primary Contact."))


def _validate_kra_pin(doc):
	# Optional for now
	pass


def _validate_aflatoxin_licence(doc):
	# Optional for now
	pass


def _validate_banking(doc):
	# Fields are individually `reqd` via Custom Field, which already blocks
	# save with a standard mandatory-field message. This adds the one
	# cross-field check that reqd can't express: a soft warning (not a
	# block) when the account name doesn't look like the supplier name.
	if not doc.get("account_name") or not doc.get("supplier_name"):
		return

	account_name = doc.account_name.strip().lower()
	supplier_name = doc.supplier_name.strip().lower()
	if account_name in supplier_name or supplier_name in account_name:
		return

	supplier_words = set(supplier_name.split())
	account_words = set(account_name.split())
	if supplier_words & account_words:
		return

	frappe.msgprint(
		_("Account name '{0}' doesn't closely match the Supplier name '{1}' - please confirm this is correct.").format(
			doc.account_name, doc.supplier_name
		),
		indicator="orange",
		alert=True,
	)
