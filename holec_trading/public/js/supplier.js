// Form script for the native Supplier doctype - Holec's custom fields
// (contacts, KRA PIN OCR, county/area, banking) live here since we can't
// edit supplier.js in frappe/erpnext itself.

frappe.ui.form.on("Supplier", {
	refresh(frm) {
		const locked = !!frm.doc.kra_pin && !frm.doc.__kra_pin_editing;
		set_kra_pin_readonly(frm, locked);
		frm.remove_custom_button(__("Edit KRA PIN"));
		if (locked && !frm.is_new()) {
			frm.add_custom_button(__("Edit KRA PIN"), () => {
				frm.doc.__kra_pin_editing = true;
				set_kra_pin_readonly(frm, false);
				frm.remove_custom_button(__("Edit KRA PIN"));
			});
		}
	},

	kra_pin_certificate(frm) {
		if (!frm.doc.kra_pin_certificate) return;

		frappe.dom.freeze(__("Reading KRA PIN certificate..."));
		frappe.call({
			method: "holec_trading.holec_trading.api.extract_kra_pin",
			args: { file_url: frm.doc.kra_pin_certificate },
			callback(r) {
				frappe.dom.unfreeze();
				const data = r.message || {};
				if (!data.ok) {
					frappe.show_alert({ message: data.message || __("Couldn't read the certificate - please enter the KRA PIN manually."), indicator: "orange" });
					return;
				}
				if (data.kra_pin) {
					frm.set_value("kra_pin", data.kra_pin);
					frm.doc.__kra_pin_editing = false;
					set_kra_pin_readonly(frm, true);
					frappe.show_alert({ message: __("KRA PIN extracted."), indicator: "green" });
				} else {
					frappe.show_alert({ message: __("Couldn't read this from the photo - please enter manually."), indicator: "orange" });
				}
			},
			error() {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("OCR failed - please enter the KRA PIN manually."), indicator: "red" });
			},
		});
	},

	county(frm) {
		frm.set_value("area", "");
	},

	bank(frm) {
		frm.set_value("bank_branch", "");
		if (frm.doc.bank) {
			frappe.db.get_value("Bank", frm.doc.bank, "swift_number").then((r) => {
				if (r.message && r.message.swift_number) {
					frm.set_value("swift_code", r.message.swift_number);
				}
			});
		}
	},

	bank_branch(frm) {
		if (!frm.doc.bank_branch) return;
		frappe.db.get_value("Bank Branch", frm.doc.bank_branch, "swift_code").then((r) => {
			if (r.message && r.message.swift_code) {
				frm.set_value("swift_code", r.message.swift_code);
			}
		});
	},
});

function set_kra_pin_readonly(frm, readonly) {
	frm.set_df_property("kra_pin", "read_only", readonly ? 1 : 0);
	frm.refresh_field("kra_pin");
}

frappe.ui.form.on("Supplier", "area", function (frm) {
	frm.set_query("area", () => ({ filters: { county: frm.doc.county } }));
});

frappe.ui.form.on("Supplier", "bank_branch", function (frm) {
	frm.set_query("bank_branch", () => ({ filters: { bank: frm.doc.bank } }));
});
