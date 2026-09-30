import base64
import io
import json
import re

from pypdf import PdfReader
from PIL import Image
import pytesseract
import frappe

# NOTE: `openai` is intentionally NOT imported here at module level.
# It's imported lazily inside the AI helpers so that a broken dependency in
# the AI stack (openai/httpx/aiohttp) cannot break the OCR-only endpoints.

KRA_PIN_RE = re.compile(r"^[AP]\d{9}[A-Z]$")

# ============================================================
# HELPER: EXTRACT KRA PIN
# ============================================================

def find_kra_pin(text):
    """Extract KRA PIN from text using multi-strategy matching."""
    if not text:
        return None

    clean_text = (
        text.upper()
        .replace(" ", "")
        .replace("\n", "")
        .replace("\r", "")
        .replace("\xa0", "")
        .replace("\t", "")
    )
    global_matches = re.findall(r"[A-Z]\d{9}[A-Z]", clean_text)
    if global_matches:
        return global_matches[0]

    normalized_text = re.sub(r"\s+", " ", text).upper()
    labeled_patterns = [
        r"TAXPAYER\s*PIN\s*[|:\-\s]*([A-Z]\d{9}[A-Z])",
        r"PERSONAL\s*IDENTIFICATION\s*NUMBER\s*[|:\-\s]*([A-Z]\d{9}[A-Z])",
        r"PIN\s*CERTIFICATE.*?[|:\-\s]*([A-Z]\d{9}[A-Z])",
        r"PIN\s*[|:\-\s]*([A-Z]\d{9}[A-Z])",
    ]
    for pattern in labeled_patterns:
        match = re.search(pattern, normalized_text)
        if match:
            return match.group(1)

    return None


def find_valid_kra_pin(text):
    """Like find_kra_pin, but only returns PINs that start with A or P."""
    if not text:
        return None
    compact = re.sub(r"\s+", "", text.upper().replace("\xa0", ""))
    m = re.search(r"[AP]\d{9}[A-Z]", compact)
    if m:
        return m.group(0)
    pin = find_kra_pin(text)
    return pin if pin and KRA_PIN_RE.match(pin) else None


def find_kra_name(text):
    """
    Extract the taxpayer name from KRA certificate text.
    Looks for a line starting with 'Name' (or 'Taxpayer Name'). 'Area Name'
    is not matched because the label must be at the start of the line.
    """
    if not text:
        return None

    label_re = re.compile(r"^\s*(?:TAXPAYER\s+)?NAME\s*[:|\-]?\s*(.*)$", re.IGNORECASE)
    lines = [ln.strip() for ln in text.splitlines()]

    for i, line in enumerate(lines):
        m = label_re.match(line)
        if not m:
            continue

        value = m.group(1).strip()
        if not value:  # value printed on the next non-empty line
            for nxt in lines[i + 1:i + 3]:
                if nxt:
                    value = nxt
                    break

        # cut off when another label starts on the same line
        value = re.split(
            r"\s{2,}|\b(?:TAX\s*PAYER|TAXPAYER|REGISTRATION|ACTIVITY|CATEGORY|PIN)\b",
            value,
            flags=re.IGNORECASE,
        )[0]
        value = re.sub(r"[^A-Za-z0-9 .,&'()\-]", " ", value)
        value = re.sub(r"\s+", " ", value).strip(" .,-|")

        if len(value) >= 3 and re.search(r"[A-Za-z]{2,}", value):
            return value.upper()

    return None


def extract_pin_from_image(image_bytes):
    """Extract KRA PIN directly from image bytes using OCR."""
    try:
        image = Image.open(io.BytesIO(image_bytes))
        page_text = pytesseract.image_to_string(image, config="--psm 6")
        pin = find_kra_pin(page_text)
        return pin, page_text
    except Exception:
        frappe.log_error(frappe.get_traceback(), "KRA Image OCR Error")
        return None, ""


def extract_kra_pin_from_pdf(pdf_bytes):
    """Extract KRA PIN from PDF via text layer first, then OCR fallback."""
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))

        text = ""
        for page in reader.pages:
            text += (page.extract_text() or "") + "\n"

        pin = find_kra_pin(text)
        if pin:
            return pin, text

        from pdf2image import convert_from_bytes

        images = convert_from_bytes(pdf_bytes, dpi=300)
        ocr_text = ""
        for image in images:
            page_text = pytesseract.image_to_string(image, config="--psm 6")
            ocr_text += page_text + "\n"
            pin = find_kra_pin(page_text)
            if pin:
                return pin, ocr_text

        return find_kra_pin(ocr_text), ocr_text
    except Exception:
        frappe.log_error(frappe.get_traceback(), "KRA PDF Processing Error")
        return None, ""


@frappe.whitelist()
def extract_kra_pin(filedata, filename=None):
    """Whitelisted entry point (used by the New Supplier screen)."""
    try:
        if "," in filedata:
            filedata = filedata.split(",", 1)[1]

        file_bytes = base64.b64decode(filedata)
        filename_lower = (filename or "").lower()

        if filename_lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
            pin, _ = extract_pin_from_image(file_bytes)
            if pin:
                return pin

        pin, text = extract_kra_pin_from_pdf(file_bytes)
        if pin:
            return pin

        pin, _ = extract_pin_from_image(file_bytes)
        if pin:
            return pin

        frappe.logger().warning(
            f"Could not find KRA PIN in file: {filename}. "
            f"Snippet: {text[:300] if 'text' in locals() and text else 'EMPTY'}"
        )
        return None

    except Exception:
        frappe.log_error(frappe.get_traceback(), "KRA PIN Extraction Error")
        return None


# ============================================================
# HELPER: SHARED AI CLIENT (AI Settings doctype)
# ============================================================
# The model name comes ONLY from AI Settings -> Default Model. There is no
# hardcoded fallback, so when the provider retires a model you just change
# the setting (no code change / deploy needed).

MODEL_HELP_URL = "https://console.groq.com/docs/models"


def _model_error_message(err, model_name):
    """Returns a friendly message if `err` means the model is unavailable, else None."""
    text = str(err).lower()
    if any(k in text for k in ("model_not_found", "model_decommissioned", "decommissioned", "does not exist")):
        return (
            f"AI model '{model_name}' is not available on this provider "
            "(retired, renamed, or your key has no access). Open AI Settings and set "
            f"'Default Model' to a currently available vision-capable model. See {MODEL_HELP_URL}"
        )
    return None


def _get_ai_client(default_max_tokens=1000):
    """Returns (client, model_name, max_tokens) from the AI Settings doctype."""
    try:
        from openai import OpenAI
    except Exception as import_error:
        frappe.log_error(frappe.get_traceback(), "OpenAI Import Error")
        raise Exception(
            "AI library failed to load on this server. This usually means a "
            "dependency (openai/httpx/aiohttp) version mismatch. "
            f"Details: {import_error}"
        )

    ai_settings = frappe.get_single("AI Settings")
    if not ai_settings.get("enable_ai_processing"):
        raise Exception("AI Processing is disabled in AI Settings.")

    api_key = ai_settings.get_password("api_key")
    if not api_key:
        raise Exception("API Key is missing from AI Settings.")

    base_url = (ai_settings.get("api_base_url") or "https://api.groq.com/openai/v1").strip()

    model_name = (ai_settings.get("default_model") or "").strip()
    if not model_name:
        raise Exception(
            "Default Model is not set in AI Settings. Set a vision-capable model. "
            f"See {MODEL_HELP_URL}"
        )

    max_tokens = int(ai_settings.get("max_tokens") or default_max_tokens)
    return OpenAI(api_key=api_key, base_url=base_url), model_name, max_tokens


def _chat_json(client, model_name, max_tokens, messages):
    """Calls the chat API, preferring JSON mode, and returns parsed JSON (dict)."""
    kwargs = {"model": model_name, "messages": messages, "temperature": 0, "max_tokens": max_tokens}
    try:
        response = client.chat.completions.create(**kwargs, response_format={"type": "json_object"})
    except Exception as first_error:
        friendly = _model_error_message(first_error, model_name)
        if friendly:
            raise Exception(friendly)
        # JSON mode may be unsupported by the model - retry without it
        try:
            response = client.chat.completions.create(**kwargs)
        except Exception as second_error:
            friendly = _model_error_message(second_error, model_name)
            raise Exception(friendly or f"AI API request failed: {second_error}")

    if not response or not response.choices or not response.choices[0].message.content:
        raise Exception("AI returned an empty response.")

    content = clean_ai_json(response.choices[0].message.content)
    try:
        return json.loads(content)
    except Exception as e:
        raise Exception(f"AI returned invalid JSON: {e}")


@frappe.whitelist()
def list_ai_models():
    """
    Diagnostic (System Manager only): lists the model IDs your API key can use
    on the configured provider. Pick a vision-capable one for AI Settings.
    Bench console:  frappe.call("holec_trading.holec_trading.page.holec_trading.holec_trading.list_ai_models")
    """
    frappe.only_for("System Manager")
    client, _model, _max = _get_ai_client()
    return sorted(m.id for m in client.models.list().data)


# ============================================================
# KRA CERTIFICATE -> PIN + REGISTERED NAME (New Customer screen)
# ============================================================

def _first_page_png(pdf_bytes):
    """Renders page 1 of a PDF to PNG bytes (for the AI vision fallback)."""
    from pdf2image import convert_from_bytes
    pages = convert_from_bytes(pdf_bytes, dpi=200, first_page=1, last_page=1)
    buf = io.BytesIO()
    pages[0].save(buf, format="PNG")
    return buf.getvalue()


def _kra_via_ai(ocr_text, image_bytes, image_ext):
    """AI fallback. Uses OCR text when available, otherwise sends the image."""
    client, model_name, max_tokens = _get_ai_client()

    system_prompt = (
        "You read Kenya Revenue Authority Taxpayer Registration Certificates. "
        "Extract ONLY values that are actually printed. Do not guess. "
        'Return ONLY valid JSON: {"pin": null, "name": null}. '
        '"pin" is the Taxpayer PIN (one letter, 9 digits, one letter). '
        '"name" is the value printed next to the label "Name" under "General Data of the Taxpayer".'
    )
    messages = [{"role": "system", "content": system_prompt}]

    if ocr_text and ocr_text.strip():
        messages.append({"role": "user", "content": f"CERTIFICATE TEXT:\n{ocr_text[:20000]}\n\nReturn JSON only."})
    elif image_bytes:
        ext = image_ext if image_ext in ("jpeg", "png", "webp") else "jpeg"
        data_url = f"data:image/{ext};base64,{base64.b64encode(image_bytes).decode()}"
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": "This is a KRA Taxpayer Registration Certificate. Return JSON only."},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        })
    else:
        raise Exception("Nothing to send to AI.")

    data = _chat_json(client, model_name, max_tokens, messages)

    pin = re.sub(r"\s+", "", str(data.get("pin") or "")).upper()
    pin = pin if KRA_PIN_RE.match(pin) else ""
    name = re.sub(r"\s+", " ", str(data.get("name") or "")).strip().upper()
    return pin, name


@frappe.whitelist()
def extract_kra_details(filedata, filename=None):
    """
    Called by the New Customer screen.
    Returns {pin, name, confidence, lookup, error}.
      1. Text layer / tesseract OCR (fast, free)
      2. AI Settings model as a fallback for anything missing
    """
    pin, name, error = "", "", ""
    confidence = 0.0

    try:
        if "," in filedata:
            filedata = filedata.split(",", 1)[1]
        file_bytes = base64.b64decode(filedata)

        fname = (filename or "").lower()
        is_pdf = fname.endswith(".pdf") or file_bytes[:4] == b"%PDF"
        ext = "png" if fname.endswith(".png") else ("webp" if fname.endswith(".webp") else "jpeg")

        # ---- 1. text layer / OCR ----
        if is_pdf:
            _, text = extract_kra_pin_from_pdf(file_bytes)
        else:
            _, text = extract_pin_from_image(file_bytes)

        pin = find_valid_kra_pin(text) or ""
        name = find_kra_name(text) or ""

        # ---- 2. AI fallback for whatever is still missing ----
        if not (pin and name):
            try:
                image_bytes, image_ext = (None, ext)
                if not (text or "").strip():
                    if is_pdf:
                        image_bytes, image_ext = _first_page_png(file_bytes), "png"
                    else:
                        image_bytes = file_bytes
                ai_pin, ai_name = _kra_via_ai(text, image_bytes, image_ext)
                pin = pin or ai_pin
                name = name or ai_name
            except Exception as ai_err:
                error = f"AI fallback failed: {ai_err}"
                frappe.log_error(frappe.get_traceback(), "extract_kra_details AI fallback")

        if pin and name:
            confidence = 0.9
        elif pin:
            confidence = 0.5
        if not pin and not error:
            error = "No valid KRA PIN found in the document."

    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        frappe.log_error(frappe.get_traceback(), "extract_kra_details failed")

    return {
        "pin": pin,
        "name": name,
        "confidence": confidence,
        "lookup": "unavailable",   # "match" / "mismatch" once GavaConnect is connected
        "error": error,
    }


# ============================================================
# HELPER: CLEAN WEIGHT
# ============================================================

def clean_weight(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        try:
            number = float(value)
            return int(number) if number.is_integer() else number
        except Exception:
            return None

    value = str(value).strip()
    if not value:
        return None

    value = re.sub(r"\b(KG|KGS|KILOGRAM|KILOGRAMS)\b", "", value, flags=re.IGNORECASE)
    value = value.replace(" ", "")

    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", value):
        value = value.replace(".", "").replace(",", "")
        try:
            return int(value)
        except Exception:
            return None

    if re.fullmatch(r"\d+", value):
        try:
            return int(value)
        except Exception:
            return None

    match = re.search(r"\d+(?:[.,]\d+)?", value)
    if not match:
        return None

    number = match.group(0)
    if re.fullmatch(r"\d{1,3}[.,]\d{3}", number):
        number = number.replace(".", "").replace(",", "")
        try:
            return int(number)
        except Exception:
            return None

    try:
        result = float(number.replace(",", ""))
        return int(result) if result.is_integer() else result
    except Exception:
        return None


# ============================================================
# HELPER: CLEAN AI JSON
# ============================================================

def clean_ai_json(content):
    if not content:
        return ""

    content = content.strip()
    content = re.sub(r"^```json\s*", "", content, flags=re.IGNORECASE)
    content = re.sub(r"^```\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    content = content.strip()

    if not content.startswith("{"):
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            content = match.group(0)

    return content.strip()


# ============================================================
# HELPER: EXTRACT PDF TEXT
# ============================================================

def extract_pdf_text(file_bytes):
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages:
            try:
                page_text = page.extract_text() or ""
                if page_text:
                    pages.append(page_text)
            except Exception:
                continue
        return "\n".join(pages)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "PDF Text Extraction Error")
        return ""


# ============================================================
# WEIGHBRIDGE AI EXTRACTION
# ============================================================

def extract_weights_via_openai(file_bytes, filename="", slip_type="gross"):
    """Extract weights and ticket info from weighbridge slip using AI."""
    try:
        # Shared client: model / key / base URL all come from AI Settings.
        try:
            client, model_name, max_tokens = _get_ai_client(default_max_tokens=2000)
        except Exception as setup_error:
            return {"error": True, "message": str(setup_error)}

        slip_type = (slip_type or "gross").lower().strip()
        if slip_type not in ["gross", "tare"]:
            slip_type = "gross"

        system_prompt = """
You are an expert OCR system for weighbridge tickets.
Read the document carefully and extract ONLY values that are actually printed.
DO NOT guess. DO NOT calculate. DO NOT invent values.

Return ONLY valid JSON using exactly:
{
    "gross_weight": null,
    "tare_weight": null,
    "net_weight": null,
    "ticket_no": null,
    "vehicle_no": null,
    "bag_count": null
}
"""

        messages = [{"role": "system", "content": system_prompt}]
        filename_lower = (filename or "").lower()

        if filename_lower.endswith(".pdf"):
            extracted_text = extract_pdf_text(file_bytes)
            if not extracted_text.strip():
                return {
                    "error": True,
                    "message": "The PDF contains no selectable text. Please upload as JPG/PNG."
                }

            user_content = f"""
This is a {slip_type.upper()} weighbridge slip.
DOCUMENT:
--------------------------------------------------
{extracted_text[:30000]}
--------------------------------------------------
Return JSON only.
"""
            messages.append({"role": "user", "content": user_content})

        else:
            base64_image = base64.b64encode(file_bytes).decode("utf-8")
            extension = filename_lower.split(".")[-1] if "." in filename_lower else "jpeg"
            if extension == "jpg":
                extension = "jpeg"
            if extension not in ["jpeg", "png", "webp"]:
                extension = "jpeg"

            image_data_url = f"data:image/{extension};base64,{base64_image}"
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": f"This is a {slip_type.upper()} weighbridge slip. Return JSON only."},
                    {"type": "image_url", "image_url": {"url": image_data_url}}
                ]
            })

        try:
            data = _chat_json(client, model_name, max_tokens, messages)
        except Exception as api_error:
            frappe.log_error(frappe.get_traceback(), "Weighbridge AI API Error")
            return {"error": True, "message": str(api_error)}

        required_fields = ["gross_weight", "tare_weight", "net_weight", "ticket_no", "vehicle_no", "bag_count"]
        for field in required_fields:
            if field not in data:
                data[field] = None

        data["gross_weight"] = clean_weight(data.get("gross_weight"))
        data["tare_weight"] = clean_weight(data.get("tare_weight"))
        data["net_weight"] = clean_weight(data.get("net_weight"))

        if data.get("ticket_no") is not None:
            data["ticket_no"] = str(data["ticket_no"]).strip() or None

        if data.get("vehicle_no") is not None:
            data["vehicle_no"] = str(data["vehicle_no"]).strip().upper() or None

        if data.get("bag_count") is not None:
            bag_match = re.search(r"\d+", str(data["bag_count"]))
            data["bag_count"] = int(bag_match.group(0)) if bag_match else None

        return data

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "OpenAI/Groq Weighbridge Extraction Error")
        return {"error": True, "message": str(e)}


# ============================================================
# MAIN FRAPPE API
# ============================================================

@frappe.whitelist()
def extract_weighbridge_data(filedata=None, file_url=None, slip_type="gross", ticket_name=None, filename=None):
    """Main API called from Frappe custom page."""
    try:
        file_bytes = None

        if filedata:
            if "," in filedata:
                filedata = filedata.split(",", 1)[1]
            try:
                file_bytes = base64.b64decode(filedata)
            except Exception as e:
                return {"success": False, "message": "Invalid file data: " + str(e)}

        elif file_url:
            try:
                file_doc = frappe.get_doc("File", {"file_url": file_url})
                file_path = file_doc.get_full_path()
                with open(file_path, "rb") as file:
                    file_bytes = file.read()
            except Exception as e:
                return {"success": False, "message": "Unable to read file: " + str(e)}

        if not file_bytes:
            return {"success": False, "message": "No file received."}

        file_size_mb = len(file_bytes) / (1024 * 1024)
        if file_size_mb > 20:
            return {"success": False, "message": f"File size is {file_size_mb:.2f} MB. Please upload smaller than 20 MB."}

        slip_type = (slip_type or "gross").lower().strip()
        if slip_type not in ["gross", "tare"]:
            slip_type = "gross"

        result = extract_weights_via_openai(file_bytes=file_bytes, filename=filename or "", slip_type=slip_type)

        if not result:
            return {"success": False, "message": "AI returned no result."}

        if isinstance(result, dict) and result.get("error"):
            return {"success": False, "message": result.get("message", "AI extraction failed.")}

        return {
            "success": True,
            "slip_type": slip_type,
            "gross_weight": result.get("gross_weight"),
            "tare_weight": result.get("tare_weight"),
            "net_weight": result.get("net_weight"),
            "ticket_no": result.get("ticket_no"),
            "vehicle_no": result.get("vehicle_no"),
            "bag_count": result.get("bag_count")
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Weighbridge AI Processing Error")
        return {"success": False, "message": "Weighbridge AI processing failed: " + str(e)}


# Add to: apps/holec_trading/holec_trading/holec_trading/page/holec_trading/holec_trading.py
# (imports at the top of that file: `import frappe` and `from frappe.utils import flt, nowdate` are already/also needed)

import frappe
from frappe.utils import flt, nowdate

COMPANY = "Holec (E.A.) Limited"


def _mode_of_payment_account(mode_of_payment, company):
    return frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": mode_of_payment, "company": company},
        "default_account",
    )


@frappe.whitelist()
def pay_transporter(ticket, mode_of_payment, reference_no=None, reference_date=None):
    """
    Pays the transporter for one Buy Ticket (haulage + cess) and marks it paid.

    Condition (same as the UI prototype): the ticket must have a transporter,
    must not already be paid (transport_paid = 0) and must have haulage or cess > 0.
    Everything runs in one request, so if any step fails nothing is saved.
    """
    from erpnext.accounts.party import get_party_account

    frappe.has_permission("Payment Entry", "create", throw=True)

    t = frappe.get_doc("Buy Ticket", ticket)

    if not t.transporter:
        frappe.throw("This ticket has no transporter.")
    if frappe.utils.cint(t.get("transport_paid")):
        frappe.throw(f"Transport for {t.name} is already paid.")

    haulage = flt(t.get("haulage_kes"))
    cess = flt(t.get("cess_kes"))
    amount = haulage + cess
    if amount <= 0:
        frappe.throw("Haulage and cess are both zero - nothing to pay.")

    if not mode_of_payment:
        frappe.throw("Please select a Mode of Payment.")

    # Money leaves this account (bank / cash of the chosen mode of payment)
    paid_from = _mode_of_payment_account(mode_of_payment, COMPANY)
    if not paid_from:
        frappe.throw(f"'{mode_of_payment}' has no default account set for {COMPANY}.")

    # ...and reduces what we owe the transporter (the transporter's payable account)
    paid_to = get_party_account("Supplier", t.transporter, COMPANY)
    if not paid_to:
        frappe.throw(f"No payable account found for transporter {t.transporter}.")

    from_ccy = frappe.db.get_value("Account", paid_from, "account_currency")
    to_ccy = frappe.db.get_value("Account", paid_to, "account_currency")
    if from_ccy != to_ccy:
        frappe.throw(f"Currency mismatch: {paid_from} is in {from_ccy} but {paid_to} is in {to_ccy}.")

    pe = frappe.get_doc({
        "doctype": "Payment Entry",
        "company": COMPANY,
        "payment_type": "Pay",
        "posting_date": nowdate(),
        "party_type": "Supplier",
        "party": t.transporter,
        "mode_of_payment": mode_of_payment,
        "paid_from": paid_from,
        "paid_to": paid_to,
        "paid_from_account_currency": from_ccy,
        "paid_to_account_currency": to_ccy,
        "paid_amount": amount,
        "received_amount": amount,
        "source_exchange_rate": 1,
        "target_exchange_rate": 1,
        # mandatory when the paid-from account is a Bank account
        "reference_no": (reference_no or "").strip() or t.name,
        "reference_date": reference_date or nowdate(),
        "custom_buy_ticket": t.name,
        "remarks": f"Transport payment for Buy Ticket {t.name}: haulage {haulage:,.0f} + cess {cess:,.0f}",
    })
    pe.insert()
    pe.submit()

    t.db_set("transport_paid", 1)
    t.db_set("transport_payment_entry", pe.name)

    return {"payment_entry": pe.name, "amount": amount, "transporter": t.transporter}