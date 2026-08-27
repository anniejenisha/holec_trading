app_name = "holec_trading"
app_title = "Holec Trading"
app_publisher = "Holec"
app_description = "Maize trading system: Lot lifecycle, Cost Ledger, Charge Master"
app_email = "ops@holec.co.ke"
app_license = "MIT"


# ---------------------------------------------------------------------------
# Doc Events
# ---------------------------------------------------------------------------
# This is the wiring that makes the "every state change must post a cost or
# an event" rule real. Frappe calls these functions automatically whenever a
# document of that type is saved, submitted, or its workflow state changes.
#
# validate  -> runs before save, can block save with frappe.throw()
# on_update -> runs after save, safe to create related records here
# on_submit -> runs when a document is submitted (if submittable)

doc_events = {
	"Lot": {
		"validate": "holec_trading.holec_trading.doctype.lot.lot.validate_state_transition",
		"on_update": "holec_trading.holec_trading.doctype.lot.lot.on_lot_state_change",
	},
	"Cost Ledger Entry": {
		"validate": "holec_trading.holec_trading.doctype.cost_ledger_entry.cost_ledger_entry.validate_no_edit_after_post",
	},
	# Buy Ticket handles its own validate/on_update via BuyTicket.validate()
	# and BuyTicket.on_update() in buy_ticket.py - no doc_events entry
	# needed (and would double-fire validate_buy_ticket if added here).
	"Supplier": {
		"validate": "holec_trading.holec_trading.supplier_hooks.validate_supplier",
	},
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
# Installed/updated on every `bench migrate`. Custom Field is scoped to just
# the doctypes this app extends, so we don't pick up unrelated custom fields
# from other apps on export.

fixtures = [
	{"doctype": "Custom Field", "filters": [["dt", "in", ["Supplier", "Bank", "Buy Ticket"]]]},
	{"doctype": "Role", "filters": [["role_name", "=", "Supplier"]]},
	"Supplier Group",
	"Bank",
	"Bank Branch",
	"Charge Master",
]

# ---------------------------------------------------------------------------
# Client scripts (desk form behaviour: OCR triggers, role-based field
# visibility, dependent-link filtering)
# ---------------------------------------------------------------------------

doctype_js = {
	# Supplier is a native doctype, so its form script must be hooked in
	# explicitly. Our own doctypes (Buy Ticket, Lot, ...) don't need an
	# entry here - Frappe auto-loads <doctype>/<doctype>.js from their own
	# doctype folder.
	"Supplier": "public/js/supplier.js",
}

# ---------------------------------------------------------------------------
# Scheduled tasks (Phase 2 - holding accrual, not needed for Sept 1 launch)
# ---------------------------------------------------------------------------
# scheduler_events = {
# 	"daily": [
# 		"holec_trading.holec_trading.tasks.accrue_daily_holding_cost",
# 	]
# }
