# Copyright (c) 2026, Holec
#
# Whitelisted OCR endpoints called from client scripts on file upload.

import frappe
from frappe import _

from holec_trading.holec_trading.ocr import OcrUnavailable, extract_fields_from_image

KRA_PIN_PROMPT = (
	"This is a photo or scan of a Kenya Revenue Authority (KRA) PIN certificate. "
	'Return ONLY a JSON object, no other text, with this exact key: "kra_pin". '
	"The KRA PIN format is one letter, 9 digits, one letter (e.g. A123456789B). "
	"If the PIN is not legible, set the value to null."
)

WEIGHBRIDGE_PROMPT = (
	"This is a photo of a weighbridge ticket showing both the gross (in) and tare (out) weighings "
	"for a single vehicle. Return ONLY a JSON object, no other text, with these exact keys: "
	'"gross_weight_kg", "tare_weight_kg", "vehicle_registration", "weighbridge_ticket_number". '
	"Weights should be plain numbers in kilograms (convert from tonnes if shown as tonnes). "
	"If a value is not legible, set it to null."
)


@frappe.whitelist()
def extract_kra_pin(file_url: str) -> dict:
	try:
		return {"ok": True, **extract_fields_from_image(file_url, KRA_PIN_PROMPT, ["kra_pin"])}
	except OcrUnavailable as e:
		return {"ok": False, "message": str(e)}


@frappe.whitelist()
def extract_weighbridge_ticket(file_url: str) -> dict:
	keys = ["gross_weight_kg", "tare_weight_kg", "vehicle_registration", "weighbridge_ticket_number"]
	try:
		return {"ok": True, **extract_fields_from_image(file_url, WEIGHBRIDGE_PROMPT, keys)}
	except OcrUnavailable as e:
		return {"ok": False, "message": str(e)}
