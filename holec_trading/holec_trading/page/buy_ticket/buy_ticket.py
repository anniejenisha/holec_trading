import frappe
from frappe.utils import nowdate, random_string

@frappe.whitelist()
def get_ticket_init_data():
    # Only show Approved suppliers
    approved_suppliers = frappe.get_all(
        "Supplier",
        filters={"custom_workflow_status": "Approved", "disabled": 0},
        fields=["name", "supplier_name", "supplier_group"]
    )

    unapproved_count = frappe.db.count("Supplier", {
        "custom_workflow_status": ["!=", "Approved"]
    })

    items = frappe.get_all("Item", filters={"is_purchase_item": 1}, fields=["name", "item_name"])
    if not items:
        items = [{"name": "Maize", "item_name": "Maize"}, {"name": "Beans", "item_name": "Beans"}]

    return {
        "suppliers": approved_suppliers,
        "unapproved_count": unapproved_count,
        "items": items,
        "today_date": nowdate()
    }

@frappe.whitelist()
def submit_new_ticket(supplier, item, expected_qty, delivery_date):
    if not supplier:
        frappe.throw("Please select a Supplier.")
    if not expected_qty:
        frappe.throw("Please enter expected quantity.")

    # 1. Create Buy Ticket Doc
    ticket = frappe.new_doc("Buy Ticket")
    if frappe.db.has_column("Buy Ticket", "supplier"):
        ticket.supplier = supplier
    if frappe.db.has_column("Buy Ticket", "item"):
        ticket.item = item
    if frappe.db.has_column("Buy Ticket", "expected_quantity"):
        ticket.expected_quantity = expected_qty
    if frappe.db.has_column("Buy Ticket", "expected_delivery_date"):
        ticket.expected_delivery_date = delivery_date
    ticket.insert(ignore_permissions=True)

    # 2. Create Lot Document linked to this ticket
    lot = frappe.new_doc("Lot")
    lot_code = "LOT-" + random_string(5).upper()
    lot.name = lot_code
    
    if frappe.db.has_column("Lot", "ticket"):
        lot.ticket = ticket.name
    if frappe.db.has_column("Lot", "supplier"):
        lot.supplier = supplier
    if frappe.db.has_column("Lot", "quantity"):
        lot.quantity = expected_qty
    if frappe.db.has_column("Lot", "state"):
        lot.state = "Ticket"
    lot.insert(ignore_permissions=True)

    frappe.db.commit()
    return {"ticket": ticket.name, "lot": lot.name}