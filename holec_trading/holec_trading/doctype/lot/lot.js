// Copyright (c) 2026, Holec
// "Advance State" button for Intake -> ... -> Settled, plus a dedicated
// Intake submission flow (weighbridge OCR, live net weight/bag count,
// moisture/aflatoxin hard-block with override) for the Ticket -> Intake
// step specifically, which needs more than a plain state flip.

const BAG_WEIGHT_KG = 90;

frappe.ui.form.on("Lot", {
	refresh(frm) {
		if (frm.is_new()) return;

		if (frm.doc.state === "Ticket") {
			setup_intake_capture(frm);
			return;
		}

		const next_state_map = {
			"Intake": "Lot",
			"Lot": "Position",
			"Position": "Invoiced",
			"Invoiced": "Settled",
		};
		const next_state = next_state_map[frm.doc.state];

		if (next_state) {
			frm.add_custom_button(__("Advance to {0}", [next_state]), () => {
				frappe.confirm(
					__("Advance this Lot from {0} to {1}? This will post any required cost entries and cannot be undone directly - only reversed.", [frm.doc.state, next_state]),
					() => {
						frappe.call({
							method: "holec_trading.holec_trading.doctype.lot.lot.advance_lot_state",
							args: { lot_name: frm.doc.name },
							freeze: true,
							freeze_message: __("Advancing state..."),
							callback: (r) => {
								if (r.message) {
									frappe.show_alert({ message: __("Lot advanced to {0}", [r.message.new_state]), indicator: "green" });
									frm.reload_doc();
								}
							},
						});
					}
				);
			}).addClass("btn-primary");
		} else {
			frm.dashboard.set_headline_alert(`<div class="indicator-pill green">${__("Settled - lifecycle complete")}</div>`);
		}

		if (frm.doc.commingled) {
			frm.dashboard.set_headline_alert(`<div class="indicator-pill orange">${__("Storage stack is commingled - origin is proportional, not exact, for this Lot")}</div>`);
		}
	},

	weighbridge_photo(frm) {
		if (!frm.doc.weighbridge_photo) return;
		frappe.dom.freeze(__("Reading weighbridge ticket..."));
		frappe.call({
			method: "holec_trading.holec_trading.api.extract_weighbridge_ticket",
			args: { file_url: frm.doc.weighbridge_photo },
			callback(r) {
				frappe.dom.unfreeze();
				const data = r.message || {};
				if (!data.ok) {
					frappe.show_alert({ message: data.message || __("Couldn't read the photo - please enter the fields manually."), indicator: "orange" });
					return;
				}
				const fields = ["gross_weight_kg", "tare_weight_kg", "vehicle_registration", "weighbridge_ticket_number"];
				let any_missing = false;
				fields.forEach((f) => {
					if (data[f] !== null && data[f] !== undefined) {
						frm.set_value(f, data[f]);
					} else {
						any_missing = true;
					}
				});
				frappe.show_alert({
					message: any_missing
						? __("Some fields couldn't be read from the photo - please check and fill in manually.")
						: __("Weighbridge ticket read successfully - please verify."),
					indicator: any_missing ? "orange" : "green",
				});
			},
			error() {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("OCR failed - please enter the fields manually."), indicator: "red" });
			},
		});
	},

	gross_weight_kg(frm) {
		recalculate_net_and_bags(frm);
	},
	tare_weight_kg(frm) {
		recalculate_net_and_bags(frm);
	},

	storage_stack(frm) {
		if (frm.doc.storage_stack) {
			frm.trigger("run_commingling_check");
		}
	},

	run_commingling_check(frm) {
		frappe.call({
			method: "check_commingling",
			doc: frm.doc,
			callback: () => frm.refresh_field("commingled"),
		});
	},
});

function recalculate_net_and_bags(frm) {
	if (frm.doc.gross_weight_kg == null || frm.doc.tare_weight_kg == null) return;
	const net = frm.doc.gross_weight_kg - frm.doc.tare_weight_kg;
	frm.set_value("net_weight_kg", net);
	if (!frm.doc.bag_count) {
		frm.set_value("bag_count", Math.floor(net / BAG_WEIGHT_KG));
	}
}

function setup_intake_capture(frm) {
	if (frm.doc.aflatoxin_pending) {
		frm.dashboard.set_headline_alert(
			`<div class="indicator-pill orange">${__("Awaiting aflatoxin lab result - intake will complete once the result is entered.")}</div>`
		);
		frm.add_custom_button(__("Enter Aflatoxin Result"), () => {
			frappe.prompt(
				[{ fieldname: "aflatoxin_ppb", fieldtype: "Float", label: __("Aflatoxin (ppb)"), reqd: 1 }],
				(values) => complete_aflatoxin(frm, values.aflatoxin_ppb, null),
				__("Aflatoxin Lab Result")
			);
		}).addClass("btn-primary");
		return;
	}

	frm.add_custom_button(__("Submit Intake"), () => submit_intake(frm, null)).addClass("btn-primary");
}

function submit_intake(frm, override_reason) {
	frappe.call({
		method: "holec_trading.holec_trading.doctype.lot.lot.submit_intake",
		args: { lot_name: frm.doc.name, override_reason },
		freeze: true,
		freeze_message: __("Submitting intake..."),
		callback(r) {
			frm.reload_doc();
			if (r.message && r.message.pending) {
				frappe.show_alert({ message: __("Saved - awaiting aflatoxin lab result."), indicator: "orange" });
			} else {
				frappe.show_alert({ message: __("Lot moved to Intake."), indicator: "green" });
			}
		},
		error(r) {
			prompt_for_override(frm, r, (reason) => submit_intake(frm, reason));
		},
	});
}

function complete_aflatoxin(frm, ppb, override_reason) {
	frappe.call({
		method: "holec_trading.holec_trading.doctype.lot.lot.complete_pending_aflatoxin",
		args: { lot_name: frm.doc.name, aflatoxin_ppb: ppb, override_reason },
		freeze: true,
		callback() {
			frm.reload_doc();
			frappe.show_alert({ message: __("Lot moved to Intake."), indicator: "green" });
		},
		error(r) {
			prompt_for_override(frm, r, (reason) => complete_aflatoxin(frm, ppb, reason));
		},
	});
}

function prompt_for_override(frm, r, retry) {
	// Frappe's own error dialog (shown automatically for the thrown
	// exception) already tells the user exactly why this was blocked -
	// this just offers the explicit, auditable override action next.
	setTimeout(() => {
		frappe.prompt(
			[{ fieldname: "override_reason", fieldtype: "Small Text", label: __("Override Reason"), reqd: 1 }],
			(values) => retry(values.override_reason),
			__("Override and Proceed"),
			__("Override and Proceed")
		);
	}, 300);
}
