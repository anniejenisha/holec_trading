import base64
import io
import re
from PIL import Image
import pytesseract
from pypdf import PdfReader
import frappe


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