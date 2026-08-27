// Copyright (c) 2026, Holec

frappe.ui.form.on("Buy Ticket", {
	refresh(frm) {
		const is_supplier = frappe.user_roles.includes("Supplier") && !frappe.user_roles.includes("Trading Officer") && !frappe.user_roles.includes("System Manager");

		// Supplier self-service view: only Commodity, Quantity, Price.
		// Never show Region, Supplier link, or Status as editable.
		frm.toggle_display(["supplier", "region", "status", "sec_break_trade"], !is_supplier);
		frm.toggle_display("commodity", true);

		if (!is_supplier && frm.doc.status === "Offered" && !frm.is_new()) {
			frm.add_custom_button(__("Accept"), () => confirm_ticket(frm), __("Actions"));
			frm.add_custom_button(__("Reject"), () => reject_ticket(frm), __("Actions"));
			frm.set_df_property("quantity_kg", "read_only", 0);
			frm.set_df_property("negotiated_price", "read_only", 0);
		}
	},
});

function confirm_ticket(frm) {
	frappe.confirm(__("Confirm this ticket and create the Lot?"), () => {
		frappe.call({
			method: "holec_trading.holec_trading.doctype.buy_ticket.buy_ticket.confirm_ticket",
			args: { ticket_name: frm.doc.name },
			freeze: true,
			callback(r) {
				frm.reload_doc();
				if (r.message) {
					frappe.show_alert({ message: __("Lot {0} created.", [r.message]), indicator: "green" });
					frappe.set_route("Form", "Lot", r.message);
				}
			},
		});
	});
}

function reject_ticket(frm) {
	frappe.prompt(
		{ fieldname: "reason", fieldtype: "Small Text", label: __("Reason (optional)") },
		(values) => {
			frappe.call({
				method: "holec_trading.holec_trading.doctype.buy_ticket.buy_ticket.reject_ticket",
				args: { ticket_name: frm.doc.name, reason: values.reason },
				freeze: true,
				callback() {
					frm.reload_doc();
				},
			});
		},
		__("Reject Ticket"),
		__("Reject"),
	);
}
