# Copyright (c) 2026, Holec

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


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
        doc.supplier = supplier_link
        if doc.is_new():
            doc.status = "Offered"
        elif doc.status not in ("Offered", "Cancelled"):
            frappe.throw(_("Only a Purchase User can confirm or reject a ticket."))
    elif doc.is_new() and doc.status in (None, "", "Draft"):
        # Purchase User (or System Manager) creating directly: goes straight to Ticket status.
        doc.status = "Ticket"

    # Use flt() for safe numeric comparisons
    if flt(doc.quantity_kg) <= 0:
        frappe.throw(_("Quantity offered must be greater than zero."))
    
    # If negotiated_price is required only when provided or default to 1.0 if not on the simplified form
    if doc.negotiated_price is not None and str(doc.negotiated_price).strip() != "":
        if flt(doc.negotiated_price) < 0:
            frappe.throw(_("Price offered must be greater than or equal to zero."))
    else:
        # Provide fallback so ticket creation succeeds from simplified view
        doc.negotiated_price = 0.0


def get_supplier_for_current_user() -> str | None:
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
        "commodity": ticket.commodity,
        "expected_quantity_kg": ticket.quantity_kg,
        "state": "Ticket",
    })
    # Add ignore_mandatory=True to allow Lot creation before weights are captured
    lot.insert(ignore_permissions=True, ignore_mandatory=True)
    return lot.name


@frappe.whitelist()
def confirm_ticket(ticket_name: str):
    _require_purchase_role()
    ticket = frappe.get_doc("Buy Ticket", ticket_name)
    if ticket.status != "Offered":
        frappe.throw(_("Only Offered tickets can be confirmed."))

    ticket.status = "Ticket"
    ticket.save()
    return frappe.db.get_value("Lot", {"buy_ticket": ticket.name}, "name")


@frappe.whitelist()
def reject_ticket(ticket_name: str, reason: str | None = None):
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