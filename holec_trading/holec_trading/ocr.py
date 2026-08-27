# Copyright (c) 2026, Holec
#
# Shared Claude Vision OCR helper. Used by both the Supplier KRA PIN
# certificate capture and the Intake weighbridge photo capture, so the
# API-call plumbing (auth, request shape, response parsing) exists in
# exactly one place.
#
# Requires an Anthropic API key in site config:
#   bench --site <site> set-config anthropic_api_key "sk-ant-..."
# Optionally override the model (defaults to a current Claude model):
#   bench --site <site> set-config anthropic_model "claude-sonnet-5"

import base64
import json
import mimetypes
import os

import frappe
import requests
from frappe import _

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-5"
ANTHROPIC_VERSION = "2023-06-01"


class OcrUnavailable(Exception):
	pass


def extract_fields_from_image(file_url: str, prompt: str, keys: list[str]) -> dict:
	"""
	Sends the file at `file_url` (a Frappe File doctype attachment URL) to
	Claude Vision with `prompt`, and returns a dict with exactly `keys`,
	each either the extracted value or None.

	Never raises for "couldn't read it" - only for hard failures (missing
	API key, network error, unreadable file). Callers should treat a dict
	of all-None as "nothing was legible" and let the user fill in by hand.
	"""
	api_key = frappe.conf.get("anthropic_api_key")
	if not api_key:
		frappe.log_error(
			title="OCR: missing anthropic_api_key",
			message="Set it with: bench --site <site> set-config anthropic_api_key <key>",
		)
		raise OcrUnavailable(_("OCR is not configured on this site. Please enter the fields manually."))

	model = frappe.conf.get("anthropic_model") or DEFAULT_MODEL

	image_b64, media_type = _read_file_as_base64(file_url)

	payload = {
		"model": model,
		"max_tokens": 1024,
		"messages": [
			{
				"role": "user",
				"content": [
					{
						"type": "image",
						"source": {"type": "base64", "media_type": media_type, "data": image_b64},
					},
					{"type": "text", "text": prompt},
				],
			}
		],
	}

	try:
		resp = requests.post(
			ANTHROPIC_API_URL,
			headers={
				"x-api-key": api_key,
				"anthropic-version": ANTHROPIC_VERSION,
				"content-type": "application/json",
			},
			data=json.dumps(payload),
			timeout=30,
		)
		resp.raise_for_status()
	except requests.RequestException as e:
		frappe.log_error(title="OCR: Anthropic API call failed", message=str(e))
		raise OcrUnavailable(_("Couldn't reach the OCR service. Please enter the fields manually.")) from e

	body = resp.json()
	text = "".join(block.get("text", "") for block in body.get("content", []) if block.get("type") == "text")
	extracted = _parse_json_response(text)

	return {key: extracted.get(key) for key in keys}


def _parse_json_response(text: str) -> dict:
	# Defensively strip markdown code fences (```json ... ``` or ``` ... ```)
	# in case the model wraps its answer despite instructions not to.
	cleaned = text.strip()
	if cleaned.startswith("```"):
		lines = cleaned.splitlines()
		if lines and lines[0].startswith("```"):
			lines = lines[1:]
		if lines and lines[-1].strip().startswith("```"):
			lines = lines[:-1]
		cleaned = "\n".join(lines).strip()

	try:
		return json.loads(cleaned)
	except (ValueError, TypeError):
		frappe.log_error(title="OCR: could not parse model response", message=text)
		return {}


def _read_file_as_base64(file_url: str) -> tuple[str, str]:
	file_doc = frappe.get_doc("File", {"file_url": file_url})
	content = file_doc.get_content()
	if isinstance(content, str):
		content = content.encode("utf-8")

	media_type, _enc = mimetypes.guess_type(file_doc.file_name or file_url)
	if not media_type:
		ext = os.path.splitext(file_doc.file_name or "")[1].lower()
		media_type = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(
			ext, "image/jpeg"
		)

	return base64.b64encode(content).decode("ascii"), media_type
