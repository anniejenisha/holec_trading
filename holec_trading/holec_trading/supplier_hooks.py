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
GRAIN_HANDLING_GROUPS = {"Farmer", "Aggregator"}


def validate_supplier(doc, method=None):
	_validate_contacts(doc)
	_validate_kra_pin(doc)
	_validate_aflatoxin_licence(doc)
	_validate_banking(doc)


def _validate_contacts(doc):
	contacts = doc.get("holec_contacts") or []

	if len(contacts) < 1:
		frappe.throw(_("At least one Contact Person is required."))
	if len(contacts) > 3:
		frappe.throw(_("A maximum of 3 Contact Persons is allowed."))

	primary_count = 0
	for row in contacts:
		if not row.phone or not KE_PHONE_RE.match(row.phone.strip()):
			frappe.throw(
				_("Row {0}: Phone number must be in the format +254XXXXXXXXX.").format(row.idx)
			)
		if row.same_as_phone:
			row.whatsapp = row.phone
		if row.is_primary:
			primary_count += 1

	if primary_count == 0:
		frappe.throw(_("Exactly one Contact Person must be marked as Primary Contact."))
	if primary_count > 1:
		frappe.throw(_("Only one Contact Person can be marked as Primary Contact."))


def _validate_kra_pin(doc):
	if not doc.get("kra_pin"):
		frappe.throw(_("KRA PIN is required (upload the certificate to auto-fill, or enter manually)."))


def _validate_aflatoxin_licence(doc):
	if doc.get("supplier_group") not in GRAIN_HANDLING_GROUPS:
		return
	if doc.get("aflatoxin_licence_on_file") and not doc.get("aflatoxin_licence_upload"):
		frappe.throw(_("Please upload the aflatoxin / food-safety licence."))


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
