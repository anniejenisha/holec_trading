import frappe

@frappe.whitelist()
def get_lots_data(state_filter=None):
    conditions = {}
    if state_filter and state_filter.lower() != "all":
        conditions["state"] = state_filter

    # Determine dynamic columns available in Lot DocType
    fields = ["name", "creation"]
    for col in ["ticket", "supplier", "origin_county", "origin_area", "quantity", "state"]:
        if frappe.db.has_column("Lot", col):
            fields.append(col)

    lots = frappe.get_all(
        "Lot",
        filters=conditions,
        fields=fields,
        order_by="creation desc"
    )

    # Calculate status tab counts
    counts = {
        "All": frappe.db.count("Lot"),
        "Ticket": frappe.db.count("Lot", {"state": "Ticket"}) if frappe.db.has_column("Lot", "state") else 0,
        "Intake": frappe.db.count("Lot", {"state": "Intake"}) if frappe.db.has_column("Lot", "state") else 0,
        "Lot": frappe.db.count("Lot", {"state": "Lot"}) if frappe.db.has_column("Lot", "state") else 0,
        "Position": frappe.db.count("Lot", {"state": "Position"}) if frappe.db.has_column("Lot", "state") else 0,
        "Invoiced": frappe.db.count("Lot", {"state": "Invoiced"}) if frappe.db.has_column("Lot", "state") else 0,
        "Settled": frappe.db.count("Lot", {"state": "Settled"}) if frappe.db.has_column("Lot", "state") else 0,
    }

    return {
        "lots": lots,
        "counts": counts
    }