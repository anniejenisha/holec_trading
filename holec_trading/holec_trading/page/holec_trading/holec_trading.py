import base64
import io
import json
import re

import frappe
from openai import OpenAI
from pypdf import PdfReader
from PIL import Image
import pytesseract
import asyncio


# ============================================================
# HELPER: EXTRACT KRA PIN
# ============================================================

def find_kra_pin(text):
    """Helper function to extract KRA PIN from text using multi-strategy

    matching for standard and alternative document layouts.
    """
    if not text:
        return None

    # Strategy 1: Search for explicit KRA PIN format globally across the text
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

    # Strategy 2: Fallback to normalized label-based matching
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


def extract_pin_from_image(image_bytes):
    """Extract KRA PIN directly from image bytes (JPG, PNG, etc.) using OCR."""
    try:
        image = Image.open(io.BytesIO(image_bytes))
        page_text = pytesseract.image_to_string(image, config="--psm 6")
        pin = find_kra_pin(page_text)
        return pin, page_text
    except Exception:
        frappe.log_error(frappe.get_traceback(), "KRA Image OCR Error")
        return None, ""


def extract_kra_pin_from_pdf(pdf_bytes):
    """Extract KRA PIN from PDF via text layer first, then fallback to OCR."""
    try:
        pdf_file = io.BytesIO(pdf_bytes)
        reader = PdfReader(pdf_file)

        text = ""
        for page in reader.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"

        pin = find_kra_pin(text)
        if pin:
            return pin, text

        # OCR Fallback for scanned PDFs
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
    """Whitelisted entry point called from the frontend JavaScript."""
    try:
        if "," in filedata:
            filedata = filedata.split(",", 1)[1]

        file_bytes = base64.b64decode(filedata)
        filename_lower = (filename or "").lower()

        # Handle image uploads directly or fallback properly
        if filename_lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
            pin, _ = extract_pin_from_image(file_bytes)
            if pin:
                return pin

        # Try PDF extraction first
        pin, text = extract_kra_pin_from_pdf(file_bytes)
        if pin:
            return pin

        # Final safety fallback: try image OCR even if filename extension wasn't explicitly matched
        pin, _ = extract_pin_from_image(file_bytes)
        if pin:
            return pin

        frappe.logger().warning(
            f"Could not find KRA PIN in file: {filename}. Snippet: {text[:300] if 'text' in locals() and text else 'EMPTY'}"
        )
        return None

    except Exception:
        frappe.log_error(frappe.get_traceback(), "KRA PIN Extraction Error")
        return None


# ============================================================
# HELPER: CLEAN WEIGHT
# ============================================================

def clean_weight(value):
    """
    Convert weight into numeric value.

    Examples:
        10.690 kg -> 10690
        10,690 kg -> 10690
        10690 kg  -> 10690
        4.250 kg  -> 4250
    """

    if value is None:
        return None

    # --------------------------------------------------------
    # Numeric value
    # --------------------------------------------------------

    if isinstance(
        value,
        (int, float)
    ):
        try:
            number = float(value)

            if number.is_integer():
                return int(number)

            return number
        except Exception:
            return None

    # --------------------------------------------------------
    # Convert to string
    # --------------------------------------------------------

    value = str(
        value
    ).strip()

    if not value:
        return None

    # --------------------------------------------------------
    # Remove units
    # --------------------------------------------------------

    value = re.sub(
        r"\b(KG|KGS|KILOGRAM|KILOGRAMS)\b",
        "",
        value,
        flags=re.IGNORECASE
    )

    # --------------------------------------------------------
    # Remove spaces
    # --------------------------------------------------------

    value = value.replace(
        " ",
        ""
    )

    # --------------------------------------------------------
    # Thousands separator
    # --------------------------------------------------------

    if re.fullmatch(
        r"\d{1,3}(?:[.,]\d{3})+",
        value
    ):
        value = (
            value
            .replace(".", "")
            .replace(",", "")
        )

        try:
            return int(value)
        except Exception:
            return None

    # --------------------------------------------------------
    # Integer
    # --------------------------------------------------------

    if re.fullmatch(
        r"\d+",
        value
    ):
        try:
            return int(value)
        except Exception:
            return None

    # --------------------------------------------------------
    # Extract numeric value
    # --------------------------------------------------------

    match = re.search(
        r"\d+(?:[.,]\d+)?",
        value
    )

    if not match:
        return None

    number = match.group(0)

    # --------------------------------------------------------
    # 4.250 -> 4250
    # --------------------------------------------------------

    if re.fullmatch(
        r"\d{1,3}[.,]\d{3}",
        number
    ):
        number = (
            number
            .replace(".", "")
            .replace(",", "")
        )

        try:
            return int(number)
        except Exception:
            return None

    # --------------------------------------------------------
    # Normal decimal
    # --------------------------------------------------------

    try:
        result = float(
            number.replace(",", "")
        )

        if result.is_integer():
            return int(result)

        return result
    except Exception:
        return None


# ============================================================
# HELPER: CLEAN AI JSON
# ============================================================

def clean_ai_json(content):
    """
    Clean JSON response from AI.
    """

    if not content:
        return ""

    content = content.strip()

    # Remove ```json
    content = re.sub(
        r"^```json\s*",
        "",
        content,
        flags=re.IGNORECASE
    )

    # Remove ```
    content = re.sub(
        r"^```\s*",
        "",
        content
    )

    content = re.sub(
        r"\s*```$",
        "",
        content
    )

    content = content.strip()

    # --------------------------------------------------------
    # Find JSON object if AI added extra text
    # --------------------------------------------------------

    if not content.startswith("{"):
        match = re.search(
            r"\{.*\}",
            content,
            re.DOTALL
        )

        if match:
            content = match.group(0)

    return content.strip()


# ============================================================
# HELPER: EXTRACT PDF TEXT
# ============================================================

def extract_pdf_text(file_bytes):
    """
    Extract selectable text from PDF.
    """

    try:
        reader = PdfReader(
            io.BytesIO(file_bytes)
        )

        pages = []

        for page in reader.pages:
            try:
                page_text = (
                    page.extract_text()
                    or ""
                )

                if page_text:
                    pages.append(
                        page_text
                    )
            except Exception:
                continue

        return "\n".join(
            pages
        )

    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "PDF Text Extraction Error"
        )

        return ""


# ============================================================
# WEIGHBRIDGE AI EXTRACTION
# ============================================================

def extract_weights_via_openai(
    file_bytes,
    filename="",
    slip_type="gross"
):
    """
    Extract weights and ticket info from weighbridge slip.
    """

    try:
        ai_settings = frappe.get_single(
            "AI Settings"
        )

        if not ai_settings.get(
            "enable_ai_processing"
        ):
            return {
                "error": True,
                "message": (
                    "AI Processing is disabled "
                    "in AI Settings."
                )
            }

        api_key = ai_settings.get_password(
            "api_key"
        )

        if not api_key:
            return {
                "error": True,
                "message": (
                    "API Key is missing "
                    "from AI Settings."
                )
            }

        base_url = (
            ai_settings.get(
                "api_base_url"
            )
            or "[https://api.groq.com/openai/v1](https://api.groq.com/openai/v1)"
        )

        base_url = base_url.strip()

        model_name = (
            ai_settings.get(
                "default_model"
            )
            or "qwen/qwen3.6-27b"
        )

        model_name = model_name.strip()

        deprecated_models = [
            "llama-3.2-11b-vision-preview",
            "llama-3.2-90b-vision-preview"
        ]

        if model_name in deprecated_models:
            model_name = (
                "qwen/qwen3.6-27b"
            )

        client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )

        slip_type = (
            slip_type
            or "gross"
        ).lower().strip()

        if slip_type not in [
            "gross",
            "tare"
        ]:
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

        messages = [
            {
                "role": "system",
                "content": system_prompt
            }
        ]

        filename_lower = (
            filename or ""
        ).lower()

        if filename_lower.endswith(
            ".pdf"
        ):
            extracted_text = (
                extract_pdf_text(
                    file_bytes
                )
            )

            if not extracted_text.strip():
                return {
                    "error": True,
                    "message": (
                        "The PDF contains no selectable "
                        "text. Please upload as JPG/PNG."
                    )
                }

            user_content = f"""
This is a {slip_type.upper()} weighbridge slip.
DOCUMENT:
--------------------------------------------------
{extracted_text[:30000]}
--------------------------------------------------
Return JSON only.
"""

            messages.append(
                {
                    "role": "user",
                    "content": user_content
                }
            )

        else:
            base64_image = (
                base64.b64encode(
                    file_bytes
                ).decode("utf-8")
            )

            extension = (
                filename_lower.split(".")[-1]
                if "." in filename_lower
                else "jpeg"
            )

            if extension == "jpg":
                extension = "jpeg"

            if extension not in [
                "jpeg",
                "png",
                "webp"
            ]:
                extension = "jpeg"

            mime_type = (
                f"image/{extension}"
            )

            image_data_url = (
                f"data:{mime_type};base64,"
                f"{base64_image}"
            )

            user_content = [
                {
                    "type": "text",
                    "text": f"This is a {slip_type.upper()} weighbridge slip. Return JSON only."
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_data_url
                    }
                }
            ]

            messages.append(
                {
                    "role": "user",
                    "content": user_content
                }
            )

        create_kwargs = {
            "model": model_name,
            "messages": messages,
            "temperature": 0,
            "max_tokens": int(
                ai_settings.get(
                    "max_tokens"
                )
                or 2000
            )
        }

        try:
            response = (
                client
                .chat
                .completions
                .create(
                    **create_kwargs,
                    response_format={
                        "type": "json_object"
                    }
                )
            )
        except Exception as first_error:
            first_error_text = str(
                first_error
            )

            if (
                "decommissioned"
                in first_error_text.lower()
                or
                "model_decommissioned"
                in first_error_text.lower()
            ):
                return {
                    "error": True,
                    "message": (
                        "Groq model is decommissioned. "
                        "Please use qwen/qwen3.6-27b."
                    )
                }

            try:
                response = (
                    client
                    .chat
                    .completions
                    .create(
                        **create_kwargs
                    )
                )
            except Exception as second_error:
                frappe.log_error(
                    frappe.get_traceback(),
                    "Groq/OpenAI API Error"
                )

                return {
                    "error": True,
                    "message": (
                        "AI API request failed:\n"
                        + str(second_error)
                    )
                }

        if not response or not response.choices:
            return {
                "error": True,
                "message": "AI returned an empty response."
            }

        content = (
            response
            .choices[0]
            .message
            .content
        )

        if not content:
            return {
                "error": True,
                "message": "AI returned empty content."
            }

        content = clean_ai_json(
            content
        )

        try:
            data = json.loads(
                content
            )
        except Exception as e:
            return {
                "error": True,
                "message": "AI returned invalid JSON: " + str(e),
                "raw_response": content
            }

        required_fields = [
            "gross_weight",
            "tare_weight",
            "net_weight",
            "ticket_no",
            "vehicle_no",
            "bag_count"
        ]

        for field in required_fields:
            if field not in data:
                data[field] = None

        data["gross_weight"] = clean_weight(data.get("gross_weight"))
        data["tare_weight"] = clean_weight(data.get("tare_weight"))
        data["net_weight"] = clean_weight(data.get("net_weight"))

        if data.get("ticket_no") is not None:
            data["ticket_no"] = str(data["ticket_no"]).strip()
            if not data["ticket_no"]:
                data["ticket_no"] = None

        if data.get("vehicle_no") is not None:
            data["vehicle_no"] = str(data["vehicle_no"]).strip().upper()
            if not data["vehicle_no"]:
                data["vehicle_no"] = None

        if data.get("bag_count") is not None:
            bag_match = re.search(
                r"\d+",
                str(data["bag_count"])
            )
            if bag_match:
                data["bag_count"] = int(bag_match.group(0))
            else:
                data["bag_count"] = None

        return data

    except Exception as e:
        frappe.log_error(
            frappe.get_traceback(),
            "OpenAI/Groq Weighbridge Extraction Error"
        )
        return {
            "error": True,
            "message": str(e)
        }


# ============================================================
# MAIN FRAPPE API
# ============================================================

@frappe.whitelist()
def extract_weighbridge_data(
    filedata=None,
    file_url=None,
    slip_type="gross",
    ticket_name=None,
    filename=None
):
    """
    Main API called from Frappe custom page.
    """

    try:
        file_bytes = None

        if filedata:
            if "," in filedata:
                filedata = filedata.split(",", 1)[1]

            try:
                file_bytes = base64.b64decode(filedata)
            except Exception as e:
                return {
                    "success": False,
                    "message": "Invalid file data: " + str(e)
                }

        elif file_url:
            try:
                file_doc = frappe.get_doc(
                    "File",
                    {"file_url": file_url}
                )
                file_path = file_doc.get_full_path()

                with open(file_path, "rb") as file:
                    file_bytes = file.read()
            except Exception as e:
                return {
                    "success": False,
                    "message": "Unable to read file: " + str(e)
                }

        if not file_bytes:
            return {
                "success": False,
                "message": "No file received."
            }

        file_size_mb = len(file_bytes) / (1024 * 1024)

        if file_size_mb > 20:
            return {
                "success": False,
                "message": f"File size is {file_size_mb:.2f} MB. Please upload smaller than 20 MB."
            }

        slip_type = (
            slip_type
            or "gross"
        ).lower().strip()

        if slip_type not in ["gross", "tare"]:
            slip_type = "gross"

        result = extract_weights_via_openai(
            file_bytes=file_bytes,
            filename=filename or "",
            slip_type=slip_type
        )

        if not result:
            return {
                "success": False,
                "message": "AI returned no result."
            }

        if isinstance(result, dict) and result.get("error"):
            return {
                "success": False,
                "message": result.get("message", "AI extraction failed.")
            }

        final_result = {
            "success": True,
            "slip_type": slip_type,
            "gross_weight": result.get("gross_weight"),
            "tare_weight": result.get("tare_weight"),
            "net_weight": result.get("net_weight"),
            "ticket_no": result.get("ticket_no"),
            "vehicle_no": result.get("vehicle_no"),
            "bag_count": result.get("bag_count")
        }

        return final_result

    except Exception as e:
        frappe.log_error(
            frappe.get_traceback(),
            "Weighbridge AI Processing Error"
        )
        return {
            "success": False,
            "message": "Weighbridge AI processing failed: " + str(e)
        }