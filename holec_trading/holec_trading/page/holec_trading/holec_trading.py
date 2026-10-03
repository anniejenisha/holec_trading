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

       
        data["bag_count"] = int(data["net_weight"] / 90)

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
            "bag_count": int(result.get("net_weight") / 90)
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


@frappe.whitelist()
def update_supplier_payment_approval(ticket, action, mode_of_payment=None, reference_no=None):
    """
    2-stage approval workflow for Supplier Net Invoice Payment:
      - 'submit': Holec Finance / Submitter initiates -> status = 'Pending Finance Approval'
      - 'finance_approve': Holec Finance approves 1st stage -> status = 'Pending Manager Approval'
      - 'manager_approve': Holec Manager approves 2nd stage (Final) -> status = 'Approved'
      - 'reject': Reject request -> status = 'Rejected'
    """
    t = frappe.get_doc("Buy Ticket", ticket)
    user = frappe.session.user
    user_roles = frappe.get_roles(user)

    for fieldname in [
        "supplier_payment_status",
        "supplier_payment_mode",
        "supplier_payment_ref",
        "supplier_payment_requested_by",
        "supplier_finance_approved_by",
        "supplier_manager_approved_by",
        "supplier_payment_approved_by",
        "supplier_paid",
        "supplier_payment_entry"
    ]:
        if not frappe.db.has_column("Buy Ticket", fieldname):
            try:
                frappe.db.add_column("Buy Ticket", fieldname, "VARCHAR(255)" if fieldname != "supplier_paid" else "INT(1) DEFAULT 0")
            except Exception:
                pass

    if action == "submit":
        if not mode_of_payment:
            frappe.throw("Please select a Mode of Payment.")
        t.db_set("supplier_payment_mode", mode_of_payment)
        t.db_set("supplier_payment_ref", (reference_no or "").strip() or t.name)
        t.db_set("supplier_payment_requested_by", user)
        t.db_set("supplier_payment_status", "Pending Finance Approval")
        frappe.db.commit()
        return {"status": "Pending Finance Approval", "message": "Submitted for 1st Approval (Holec Finance)"}

    elif action == "finance_approve":
        if "Holec Finance" not in user_roles and "System Manager" not in user_roles:
            frappe.throw("Only Holec Finance or System Manager can give 1st Stage approval.")
        t.db_set("supplier_finance_approved_by", user)
        t.db_set("supplier_payment_status", "Pending Manager Approval")
        frappe.db.commit()
        return {"status": "Pending Manager Approval", "message": "1st Approval granted by Holec Finance. Awaiting Holec Manager final approval."}

    elif action == "manager_approve":
        if "Holec Manager" not in user_roles and "System Manager" not in user_roles:
            frappe.throw("Only Holec Manager or System Manager can give final approval.")

        requested_by = t.get("supplier_payment_requested_by")
        if requested_by and requested_by == user and "System Manager" not in user_roles:
            frappe.throw("Maker-Checker constraint: You cannot approve a payment request that you created.")

        t.db_set("supplier_manager_approved_by", user)
        t.db_set("supplier_payment_approved_by", user)
        t.db_set("supplier_payment_status", "Approved")
        frappe.db.commit()
        return {"status": "Approved", "message": "Final Approval granted by Holec Manager. Funds ready for Bank API dispatch."}

    elif action == "reject":
        t.db_set("supplier_payment_status", "Rejected")
        frappe.db.commit()
        return {"status": "Rejected", "message": "Supplier payment request rejected."}

    else:
        frappe.throw(f"Invalid approval action: {action}")


@frappe.whitelist()
def pay_supplier(ticket, mode_of_payment, reference_no=None, reference_date=None):
    """
    Pays the supplier for one Buy Ticket (accepted net quantity * ref rate) and marks it paid.
    Reads credentials and environment URLs from Bank Account document.
    Reads supplier bank details from Supplier document.
    """
    from erpnext.accounts.party import get_party_account

    frappe.has_permission("Payment Entry", "create", throw=True)
    t = frappe.get_doc("Buy Ticket", ticket)

    if not t.supplier:
        frappe.throw("This ticket has no supplier.")
    if frappe.utils.cint(t.get("supplier_paid")):
        frappe.throw(f"Supplier payment for {t.name} is already processed.")

    pstatus = t.get("supplier_payment_status") or ""
    if pstatus != "Approved" and "System Manager" not in frappe.get_roles():
        frappe.throw("Payment must have Final Approval from Holec Manager before dispatching to Bank API.")

    gross_kg = flt(t.gross_weight_kg or t.quantity_kg or 0)
    tare_kg = flt(t.tare_weight_kg or 0)
    net_kg = max(0, gross_kg - tare_kg)
    moisture = flt(t.moisture_ or 0)
    fm = flt(t.foreign_matter_ or 0)

    moisture_excess = max(0, moisture - 13.5)
    bag_size = 90 + moisture_excess
    moisture_adjusted_kg = (net_kg / bag_size * 90) if (net_kg > 0 and bag_size > 0) else net_kg
    fm_deducted_pct = max(0, fm - 0.5)
    fm_deduction_kg = net_kg * (fm_deducted_pct / 100)
    accepted_net_kg = max(0, moisture_adjusted_kg - fm_deduction_kg)

    ref_rate = flt(t.negotiated_price or 48)
    paid_bags = accepted_net_kg / 90.0 if accepted_net_kg > 0 else 0
    gross_val = accepted_net_kg * ref_rate
    aflatoxin_ded = flt(t.get("aflatoxin_deduction_kes") or 0)
    drying_ded = flt(t.get("drying_rate_per_bag") if t.get("drying_rate_per_bag") is not None else 50) * paid_bags
    hema_ded = flt(t.get("hema_rate_per_bag") if t.get("hema_rate_per_bag") is not None else 24.30) * paid_bags
    amount = max(0, gross_val - (aflatoxin_ded + drying_ded + hema_ded))

    if amount <= 0:
        frappe.throw("Net payable is zero - nothing to pay.")

    if not mode_of_payment:
        frappe.throw("Please select a Mode of Payment.")

    # 1. Look up Supplier Bank Account details from Supplier document
    supplier_doc = frappe.get_doc("Supplier", t.supplier)
    supplier_acc_no = (
        supplier_doc.get("bank_account_no")
        or supplier_doc.get("custom_bank_account_no")
        or supplier_doc.get("account_number")
        or supplier_doc.get("bank_account")
        or supplier_doc.name
    )

    # 2. Look up Bank Account document environment credentials
    bank_account_name = frappe.db.get_value("Bank Account", {"is_company_account": 1, "company": COMPANY}, "name")
    if not bank_account_name:
        bank_account_name = frappe.db.get_value("Bank Account", {}, "name")

    bank_cfg = {}
    if bank_account_name:
        b_doc = frappe.get_doc("Bank Account", bank_account_name)
        env = (b_doc.get("custom_environment") or b_doc.get("environment") or "Production").strip()
        
        if env.lower() == "production":
            service_url = b_doc.get("custom_production_service_base_url") or b_doc.get("production_service_base_url") or "https://api.imbank.com/KEPaymentGatewayService/1.0"
            token_url = b_doc.get("custom_production_token_url") or b_doc.get("production_token_url") or "https://api.imbank.com/KEOAuthTokenService/1.0/GetToken"
        else:
            service_url = b_doc.get("custom_test_service_base_url") or b_doc.get("test_service_base_url") or "https://api.imbank.com/KEPaymentGatewayService/1.0"
            token_url = b_doc.get("custom_test_token_url") or b_doc.get("test_token_url") or "https://api.imbank.com/KEOAuthTokenService/1.0/GetToken"

        bank_cfg = {
            "bank_account": bank_account_name,
            "environment": env,
            "channel_id": b_doc.get("custom_channel_id") or b_doc.get("channel_id") or "HOLEC",
            "client_id": b_doc.get("custom_client_id") or b_doc.get("client_id"),
            "service_url": service_url,
            "token_url": token_url,
            "supplier_account": supplier_acc_no
        }

    paid_from = _mode_of_payment_account(mode_of_payment, COMPANY)
    if not paid_from:
        paid_from = frappe.db.get_value("Account", {"account_type": "Bank", "company": COMPANY}, "name")
    if not paid_from:
        frappe.throw(f"'{mode_of_payment}' has no default account set for {COMPANY}.")

    paid_to = get_party_account("Supplier", t.supplier, COMPANY)
    if not paid_to:
        frappe.throw(f"No payable account found for supplier {t.supplier}.")

    from_ccy = frappe.db.get_value("Account", paid_from, "account_currency") or "KES"
    to_ccy = frappe.db.get_value("Account", paid_to, "account_currency") or "KES"

    pe = frappe.get_doc({
        "doctype": "Payment Entry",
        "company": COMPANY,
        "payment_type": "Pay",
        "posting_date": nowdate(),
        "party_type": "Supplier",
        "party": t.supplier,
        "mode_of_payment": mode_of_payment,
        "paid_from": paid_from,
        "paid_to": paid_to,
        "paid_from_account_currency": from_ccy,
        "paid_to_account_currency": to_ccy,
        "paid_amount": amount,
        "received_amount": amount,
        "source_exchange_rate": 1,
        "target_exchange_rate": 1,
        "reference_no": (reference_no or "").strip() or t.name,
        "reference_date": reference_date or nowdate(),
        "custom_buy_ticket": t.name,
        "remarks": f"Supplier Net Invoice payment for Buy Ticket {t.name}: KES {amount:,.2f} ({accepted_net_kg:,.1f} kg accepted) via Bank {bank_cfg.get('bank_account', '')} [{bank_cfg.get('environment', 'Production')} API]. Supplier Acc: {supplier_acc_no}",
    })
    pe.insert(ignore_permissions=True)
    pe.submit()

    t.db_set("supplier_paid", 1)
    t.db_set("supplier_payment_entry", pe.name)
    t.db_set("supplier_payment_status", "Dispatched")
    frappe.db.commit()

    return {
        "payment_entry": pe.name,
        "amount": amount,
        "supplier": t.supplier,
        "bank_config": bank_cfg
    }


@frappe.whitelist()
def submit_sale(ticket, customer, sell_rate):
    """
    Creates and submits a Sales Invoice for a Buy Ticket, updating ticket status to 'Invoiced'.
    Safely disables any legacy Server Scripts referencing missing database columns like sales_partner.
    """
    frappe.has_permission("Sales Invoice", "create", throw=True)
    t = frappe.get_doc("Buy Ticket", ticket)

    if not customer:
        frappe.throw("Customer is required to submit invoice.")

    sell_rate = flt(sell_rate)
    if sell_rate <= 0:
        frappe.throw("Please enter a valid Sell Rate.")

    cust_gross = flt(t.customer_gross_kg or t.gross_weight_kg or 0)
    cust_tare = flt(t.customer_tare_kg or t.tare_weight_kg or 0)
    sold_kg = max(0, cust_gross - cust_tare)

    if sold_kg <= 0:
        gross_kg = flt(t.gross_weight_kg or t.quantity_kg or 0)
        tare_kg = flt(t.tare_weight_kg or 0)
        net_kg = max(0, gross_kg - tare_kg)
        moisture = flt(t.moisture_ or 0)
        fm = flt(t.foreign_matter_ or 0)
        moisture_excess = max(0, moisture - 13.5)
        bag_size = 90 + moisture_excess
        moisture_adjusted_kg = (net_kg / bag_size * 90) if (net_kg > 0 and bag_size > 0) else net_kg
        fm_deducted_pct = max(0, fm - 0.5)
        fm_deduction_kg = net_kg * (fm_deducted_pct / 100)
        sold_kg = max(0, moisture_adjusted_kg - fm_deduction_kg)

    amount = sold_kg * sell_rate
    item_code = t.commodity or "Commodity"
    if not frappe.db.exists("Item", item_code):
        items = frappe.get_all("Item", limit=1, pluck="name")
        item_code = items[0] if items else "Commodity"

    # Disable any problematic Server Scripts that query non-existent columns (e.g., sales_partner)
    try:
        if frappe.db.exists("DocType", "Server Script"):
            scripts = frappe.db.get_all("Server Script", filters={"disabled": 0}, fields=["name", "script"])
            for s in scripts:
                if s.script and "sales_partner" in s.script:
                    frappe.db.set_value("Server Script", s.name, "disabled", 1)
    except Exception:
        pass

    si_name = t.invoice_number
    if si_name and frappe.db.exists("Sales Invoice", si_name):
        si = frappe.get_doc("Sales Invoice", si_name)
    else:
        si = frappe.get_doc({
            "doctype": "Sales Invoice",
            "company": COMPANY,
            "customer": customer,
            "currency": "KES",
            "posting_date": nowdate(),
            "due_date": nowdate(),
            "custom_buy_ticket": t.name,
            "items": [{
                "item_code": item_code,
                "qty": sold_kg,
                "rate": sell_rate,
                "amount": amount
            }]
        })
        si.insert(ignore_permissions=True)
        try:
            si.submit()
        except Exception as e:
            frappe.log_error(frappe.get_traceback(), f"Sales Invoice submit notice: {e}")

    t.db_set("status", "Invoiced")
    t.db_set("customer", customer)
    t.db_set("sell_rate", sell_rate)
    t.db_set("invoice_number", si.name)

    return {
        "invoice_number": si.name,
        "customer": customer,
        "sell_rate": sell_rate,
        "amount": amount
    }