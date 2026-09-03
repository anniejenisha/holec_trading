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


import base64
import io
import os
import re

import frappe
import pytesseract

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pypdf import PdfReader


# ============================================================
# COMMON HELPERS
# ============================================================

def normalize_ocr_text(text):
    """
    Normalize OCR text without destroying useful information.
    """
    if not text:
        return ""

    text = text.replace("\xa0", " ")
    text = text.replace("\r", "\n")

    # Normalize common OCR characters
    replacements = {
        "—": "-",
        "–": "-",
        "−": "-",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    # Keep line structure because labels and values are often
    # on the same/next line.
    lines = []

    for line in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()

        if line:
            lines.append(line)

    return "\n".join(lines)


def clean_weight(value):
    """
    Convert OCR weight such as:
        11,580
        11580
        11 580
        11580 kg
    into integer/float.
    """
    if value is None:
        return None

    value = str(value).strip().upper()

    # Remove KG and other text
    value = re.sub(r"\bKG\b", "", value, flags=re.I)

    # Remove spaces inside numbers
    value = re.sub(r"(?<=\d)\s+(?=\d)", "", value)

    # Keep only digits, comma and decimal point
    value = re.sub(r"[^0-9.,]", "", value)

    if not value:
        return None

    # 11,580 -> 11580
    value = value.replace(",", "")

    try:
        number = float(value)

        if number.is_integer():
            return int(number)

        return number

    except Exception:
        return None


def clean_integer(value):
    """
    Convert OCR numeric text to integer.
    """
    if value is None:
        return None

    value = str(value)

    value = re.sub(r"[^0-9]", "", value)

    if not value:
        return None

    try:
        return int(value)
    except Exception:
        return None


def normalize_ticket(value):
    """
    Clean ticket number.

    Example:
        MGL00352
        257798
        WB-88213
    """
    if not value:
        return ""

    value = value.upper().strip()

    value = re.sub(r"[^A-Z0-9_-]", "", value)

    return value


def normalize_vehicle(value):
    """
    Clean vehicle registration.

    Kenyan examples:
        KAS123A
        KDA 123A
        Kxx 123A
    """
    if not value:
        return ""

    value = value.upper().strip()

    value = re.sub(r"[^A-Z0-9]", "", value)

    return value


# ============================================================
# IMAGE PREPROCESSING
# ============================================================

def preprocess_image(image):
    """
    Create multiple OCR-friendly versions of the image.
    This helps with mobile photos, faded receipts and rotated slips.
    """

    if image.mode != "RGB":
        image = image.convert("RGB")

    # Upscale
    scale = 2

    image = image.resize(
        (
            image.width * scale,
            image.height * scale
        )
    )

    gray = ImageOps.grayscale(image)

    # Improve contrast
    contrast = ImageEnhance.Contrast(gray).enhance(2.2)

    # Sharpen
    sharpen = contrast.filter(ImageFilter.SHARPEN)

    # Threshold
    threshold = sharpen.point(
        lambda p: 255 if p > 160 else 0
    )

    return [
        image,
        gray,
        contrast,
        sharpen,
        threshold,
    ]


def get_ocr_candidates(image):
    """
    OCR the image using multiple rotations and preprocessing modes.

    Returns a list of:
        {
            text: "...",
            score: 123
        }
    """

    candidates = []

    # We intentionally try all rotations because mobile images
    # may be uploaded sideways.
    for angle in [0, 90, 180, 270]:

        try:
            rotated = image.rotate(
                angle,
                expand=True,
                fillcolor="white"
            )

            processed_images = preprocess_image(rotated)

            for processed in processed_images:

                for psm in [6, 11, 12]:

                    try:
                        data = pytesseract.image_to_data(
                            processed,
                            config=f"--psm {psm}",
                            output_type=pytesseract.Output.DICT
                        )

                        text_parts = []
                        confidence_values = []

                        for i, word in enumerate(data["text"]):

                            word = (word or "").strip()

                            if word:
                                text_parts.append(word)

                                try:
                                    confidence = float(
                                        data["conf"][i]
                                    )

                                    if confidence >= 0:
                                        confidence_values.append(
                                            confidence
                                        )

                                except Exception:
                                    pass

                        text = " ".join(text_parts)

                        if not text:
                            continue

                        avg_confidence = (
                            sum(confidence_values)
                            / len(confidence_values)
                            if confidence_values
                            else 0
                        )

                        # Give extra weight to documents containing
                        # important weighbridge labels.
                        upper_text = text.upper()

                        keyword_score = 0

                        keywords = [
                            "GROSS",
                            "TARE",
                            "NET",
                            "WEIGHT",
                            "TICKET",
                            "VEHICLE",
                            "BAGS",
                            "BRIDGE",
                        ]

                        for keyword in keywords:
                            if keyword in upper_text:
                                keyword_score += 15

                        score = avg_confidence + keyword_score

                        candidates.append(
                            {
                                "text": text,
                                "score": score,
                                "angle": angle,
                            }
                        )

                    except Exception:
                        continue

        except Exception:
            continue

    candidates.sort(
        key=lambda x: x["score"],
        reverse=True
    )

    return candidates


# ============================================================
# FIELD EXTRACTION
# ============================================================

def extract_weight_from_label(text, labels):
    """
    Search for a weight next to a label.

    Examples:
        GROSS WEIGHT : 11,580 KG
        GROSS_WT : 11580 KG
        GROSS WT 11580
        G.WT : 11580
        TARE WEIGHT : 4860 KG
        NET WEIGHT : 6720 KG
    """

    if not text:
        return None

    normalized = normalize_ocr_text(text)

    # OCR can split words into different lines.
    compact = re.sub(
        r"\s+",
        " ",
        normalized.upper()
    )

    for label in labels:

        label_pattern = label.upper()

        # Label followed by optional punctuation and weight
        pattern = (
            rf"{label_pattern}"
            r"(?:\s*[:#=\-]\s*|\s+)"
            r"([0-9][0-9,\s]*(?:\.[0-9]+)?)"
            r"\s*(?:KG|KGS)?"
        )

        match = re.search(
            pattern,
            compact,
            flags=re.I
        )

        if match:
            weight = clean_weight(match.group(1))

            if weight is not None:
                return weight

    # Second pass: inspect individual lines.
    lines = normalized.upper().splitlines()

    for index, line in enumerate(lines):

        for label in labels:

            if label.upper() in line:

                # Current line
                match = re.search(
                    r"([0-9][0-9,\s]*(?:\.[0-9]+)?)\s*(?:KG|KGS)?",
                    line,
                    flags=re.I
                )

                if match:

                    weight = clean_weight(
                        match.group(1)
                    )

                    if weight is not None:
                        return weight

                # Next line
                if index + 1 < len(lines):

                    next_line = lines[index + 1]

                    match = re.search(
                        r"([0-9][0-9,\s]*(?:\.[0-9]+)?)\s*(?:KG|KGS)?",
                        next_line,
                        flags=re.I
                    )

                    if match:

                        weight = clean_weight(
                            match.group(1)
                        )

                        if weight is not None:
                            return weight

    return None


def extract_ticket_number(text):
    """
    Extract weighbridge ticket number.

    Handles:
        Ticket No : MGL00352
        Ticket Number : MGL00352
        TICKET NO 257798
        TKT : WB-88213
    """

    if not text:
        return ""

    normalized = normalize_ocr_text(text)
    upper = normalized.upper()

    patterns = [

        # Ticket Number / Ticket No
        r"(?:TICKET\s*(?:NUMBER|NO|NUM)?|TKT)"
        r"\s*[:#=\-]?\s*"
        r"([A-Z0-9][A-Z0-9_-]{3,30})",

        # Some slips print only "NO:"
        r"\bNO\.?\s*[:#=\-]\s*"
        r"([A-Z0-9][A-Z0-9_-]{3,30})",
    ]

    for pattern in patterns:

        matches = re.findall(
            pattern,
            upper,
            flags=re.I
        )

        for value in matches:

            value = normalize_ticket(value)

            if not value:
                continue

            # Avoid obvious words accidentally captured as ticket.
            bad_values = {
                "WEIGHT",
                "GROSS",
                "TARE",
                "NET",
                "DATE",
                "NAME",
                "NUMBER",
                "VEHICLE",
            }

            if value in bad_values:
                continue

            return value

    return ""


def extract_vehicle_registration(text):
    """
    Extract vehicle registration from OCR.

    Example:
        VEHICLE NO : KAS123A
        VEHICLE REG : KAS 123A
        VEHICLE REGISTRATION : KDA123A
    """

    if not text:
        return ""

    normalized = normalize_ocr_text(text)
    upper = normalized.upper()

    patterns = [

        r"(?:VEHICLE\s*(?:NO|NUMBER|REG|REGISTRATION)?"
        r"|VEH|TRUCK)"
        r"\s*[:#=\-]?\s*"
        r"([A-Z]{1,4}\s*[0-9]{1,5}\s*[A-Z]{0,3})",

        r"\b([A-Z]{2,4}\s*[0-9]{2,5}\s*[A-Z])\b",
    ]

    for pattern in patterns:

        match = re.search(
            pattern,
            upper,
            flags=re.I
        )

        if match:

            vehicle = normalize_vehicle(
                match.group(1)
            )

            if len(vehicle) >= 4:
                return vehicle

    return ""


def extract_bag_count(text):
    """
    Extract bag count.

    Handles:
        BAGS : 31
        BAG COUNT : 31
        NO OF BAGS : 31
        BAGS 31
    """

    if not text:
        return None

    normalized = normalize_ocr_text(text)
    upper = normalized.upper()

    patterns = [

        r"(?:BAG\s*COUNT|NO\.?\s*OF\s*BAGS|NUMBER\s*OF\s*BAGS)"
        r"\s*[:#=\-]?\s*(\d{1,5})",

        r"\bBAGS?\s*[:#=\-]?\s*(\d{1,5})",

        r"\bQTY\s*[:#=\-]?\s*(\d{1,5})",

        r"\bPACKETS?\s*[:#=\-]?\s*(\d{1,5})",
    ]

    for pattern in patterns:

        match = re.search(
            pattern,
            upper,
            flags=re.I
        )

        if match:

            value = clean_integer(
                match.group(1)
            )

            if value is not None and 0 < value <= 10000:
                return value

    return None


# ============================================================
# OCR RESULT COMBINATION
# ============================================================

def extract_weighbridge_fields(text):
    """
    Extract all weighbridge fields from OCR text.
    """

    text = normalize_ocr_text(text)

    gross = extract_weight_from_label(
        text,
        [
            r"GROSS\s*(?:WT|WEIGHT)",
            r"GROSS_WT",
            r"GROSS",
            r"G\.?\s*WT",
            r"GW",
        ]
    )

    tare = extract_weight_from_label(
        text,
        [
            r"TARE\s*(?:WT|WEIGHT)",
            r"TARE_WT",
            r"TARE",
            r"T\.?\s*WT",
            r"TW",
        ]
    )

    net = extract_weight_from_label(
        text,
        [
            r"NET\s*(?:WT|WEIGHT)",
            r"NET_WT",
            r"NET",
            r"N\.?\s*WT",
            r"NW",
        ]
    )

    ticket = extract_ticket_number(text)

    vehicle = extract_vehicle_registration(text)

    bags = extract_bag_count(text)

    # Calculate net if gross and tare are available.
    calculated_net = None

    if gross is not None and tare is not None:
        calculated_net = max(
            0,
            gross - tare
        )

    # If OCR did not find printed net weight,
    # use calculated net.
    if net is None and calculated_net is not None:
        net = calculated_net

    return {
        "gross_weight_kg": gross or 0,
        "tare_weight_kg": tare or 0,
        "net_weight_kg": net or 0,
        "bag_count": bags or 0,
        "weighbridge_ticket_number": ticket or "",
        "vehicle_registration": vehicle or "",
    }


# ============================================================
# IMAGE OCR
# ============================================================

def extract_weighbridge_from_image(image_bytes):
    """
    OCR a weighbridge image.

    Multiple rotations and preprocessing methods are tried.
    """

    try:

        image = Image.open(
            io.BytesIO(image_bytes)
        )

        candidates = get_ocr_candidates(image)

        if not candidates:
            return {
                "data": {
                    "gross_weight_kg": 0,
                    "tare_weight_kg": 0,
                    "net_weight_kg": 0,
                    "bag_count": 0,
                    "weighbridge_ticket_number": "",
                    "vehicle_registration": "",
                },
                "text": "",
            }

        # Combine top OCR results.
        #
        # This is important because one OCR version may read
        # "GROSS" correctly while another reads the number correctly.
        top_candidates = candidates[:8]

        combined_text = "\n".join(
            candidate["text"]
            for candidate in top_candidates
        )

        data = extract_weighbridge_fields(
            combined_text
        )

        return {
            "data": data,
            "text": combined_text,
        }

    except Exception:

        frappe.log_error(
            frappe.get_traceback(),
            "Weighbridge Image OCR Error"
        )

        return {
            "data": {
                "gross_weight_kg": 0,
                "tare_weight_kg": 0,
                "net_weight_kg": 0,
                "bag_count": 0,
                "weighbridge_ticket_number": "",
                "vehicle_registration": "",
            },
            "text": "",
        }


# ============================================================
# PDF OCR
# ============================================================

def extract_weighbridge_from_pdf(pdf_bytes):
    """
    First try the PDF text layer.
    If that fails, render PDF pages and perform OCR.
    """

    try:

        pdf_file = io.BytesIO(pdf_bytes)

        reader = PdfReader(pdf_file)

        all_text = ""

        for page in reader.pages:

            page_text = page.extract_text() or ""

            all_text += "\n" + page_text

        all_text = normalize_ocr_text(
            all_text
        )

        data = extract_weighbridge_fields(
            all_text
        )

        # If useful fields were found, return them.
        if (
            data["gross_weight_kg"]
            or data["tare_weight_kg"]
            or data["net_weight_kg"]
            or data["weighbridge_ticket_number"]
        ):

            return {
                "data": data,
                "text": all_text,
            }

        # ----------------------------------------------------
        # PDF OCR fallback
        # ----------------------------------------------------

        from pdf2image import convert_from_bytes

        pages = convert_from_bytes(
            pdf_bytes,
            dpi=300
        )

        all_ocr_text = ""

        for page_image in pages:

            result = extract_weighbridge_from_image(
                io.BytesIO(
                    _image_to_bytes(page_image)
                ).getvalue()
            )

            page_data = result["data"]

            all_ocr_text += "\n" + result["text"]

            # Return immediately if meaningful data exists.
            if (
                page_data["gross_weight_kg"]
                or page_data["tare_weight_kg"]
                or page_data["weighbridge_ticket_number"]
            ):
                return result

        final_data = extract_weighbridge_fields(
            all_ocr_text
        )

        return {
            "data": final_data,
            "text": all_ocr_text,
        }

    except Exception:

        frappe.log_error(
            frappe.get_traceback(),
            "Weighbridge PDF OCR Error"
        )

        return {
            "data": {
                "gross_weight_kg": 0,
                "tare_weight_kg": 0,
                "net_weight_kg": 0,
                "bag_count": 0,
                "weighbridge_ticket_number": "",
                "vehicle_registration": "",
            },
            "text": "",
        }


def _image_to_bytes(image):
    """
    Convert PIL Image to JPEG bytes.
    """

    buffer = io.BytesIO()

    image.save(
        buffer,
        format="JPEG",
        quality=95
    )

    return buffer.getvalue()


#import base64
import io
import os
import re

import frappe
import pytesseract

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pypdf import PdfReader


# ============================================================
# COMMON HELPERS
# ============================================================

def normalize_ocr_text(text):
    """
    Normalize OCR text without destroying useful information.
    """
    if not text:
        return ""

    text = text.replace("\xa0", " ")
    text = text.replace("\r", "\n")

    # Normalize common OCR characters
    replacements = {
        "—": "-",
        "–": "-",
        "−": "-",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    # Keep line structure because labels and values are often
    # on the same/next line.
    lines = []

    for line in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()

        if line:
            lines.append(line)

    return "\n".join(lines)


def clean_weight(value):
    """
    Convert OCR weight such as:
        11,580
        11580
        11 580
        11580 kg
    into integer/float.
    """
    if value is None:
        return None

    value = str(value).strip().upper()

    # Remove KG and other text
    value = re.sub(r"\bKG\b", "", value, flags=re.I)

    # Remove spaces inside numbers
    value = re.sub(r"(?<=\d)\s+(?=\d)", "", value)

    # Keep only digits, comma and decimal point
    value = re.sub(r"[^0-9.,]", "", value)

    if not value:
        return None

    # 11,580 -> 11580
    value = value.replace(",", "")

    try:
        number = float(value)

        if number.is_integer():
            return int(number)

        return number

    except Exception:
        return None


def clean_integer(value):
    """
    Convert OCR numeric text to integer.
    """
    if value is None:
        return None

    value = str(value)

    value = re.sub(r"[^0-9]", "", value)

    if not value:
        return None

    try:
        return int(value)
    except Exception:
        return None


def normalize_ticket(value):
    """
    Clean ticket number.

    Example:
        MGL00352
        257798
        WB-88213
    """
    if not value:
        return ""

    value = value.upper().strip()

    value = re.sub(r"[^A-Z0-9_-]", "", value)

    return value


def normalize_vehicle(value):
    """
    Clean vehicle registration.

    Kenyan examples:
        KAS123A
        KDA 123A
        Kxx 123A
    """
    if not value:
        return ""

    value = value.upper().strip()

    value = re.sub(r"[^A-Z0-9]", "", value)

    return value


# ============================================================
# IMAGE PREPROCESSING
# ============================================================

def preprocess_image(image):
    """
    Create multiple OCR-friendly versions of the image.
    This helps with mobile photos, faded receipts and rotated slips.
    """

    if image.mode != "RGB":
        image = image.convert("RGB")

    # Upscale
    scale = 2

    image = image.resize(
        (
            image.width * scale,
            image.height * scale
        )
    )

    gray = ImageOps.grayscale(image)

    # Improve contrast
    contrast = ImageEnhance.Contrast(gray).enhance(2.2)

    # Sharpen
    sharpen = contrast.filter(ImageFilter.SHARPEN)

    # Threshold
    threshold = sharpen.point(
        lambda p: 255 if p > 160 else 0
    )

    return [
        image,
        gray,
        contrast,
        sharpen,
        threshold,
    ]


def get_ocr_candidates(image):
    """
    OCR the image using multiple rotations and preprocessing modes.

    Returns a list of:
        {
            text: "...",
            score: 123
        }
    """

    candidates = []

    # We intentionally try all rotations because mobile images
    # may be uploaded sideways.
    for angle in [0, 90, 180, 270]:

        try:
            rotated = image.rotate(
                angle,
                expand=True,
                fillcolor="white"
            )

            processed_images = preprocess_image(rotated)

            for processed in processed_images:

                for psm in [6, 11, 12]:

                    try:
                        data = pytesseract.image_to_data(
                            processed,
                            config=f"--psm {psm}",
                            output_type=pytesseract.Output.DICT
                        )

                        text_parts = []
                        confidence_values = []

                        for i, word in enumerate(data["text"]):

                            word = (word or "").strip()

                            if word:
                                text_parts.append(word)

                                try:
                                    confidence = float(
                                        data["conf"][i]
                                    )

                                    if confidence >= 0:
                                        confidence_values.append(
                                            confidence
                                        )

                                except Exception:
                                    pass

                        text = " ".join(text_parts)

                        if not text:
                            continue

                        avg_confidence = (
                            sum(confidence_values)
                            / len(confidence_values)
                            if confidence_values
                            else 0
                        )

                        # Give extra weight to documents containing
                        # important weighbridge labels.
                        upper_text = text.upper()

                        keyword_score = 0

                        keywords = [
                            "GROSS",
                            "TARE",
                            "NET",
                            "WEIGHT",
                            "TICKET",
                            "VEHICLE",
                            "BAGS",
                            "BRIDGE",
                        ]

                        for keyword in keywords:
                            if keyword in upper_text:
                                keyword_score += 15

                        score = avg_confidence + keyword_score

                        candidates.append(
                            {
                                "text": text,
                                "score": score,
                                "angle": angle,
                            }
                        )

                    except Exception:
                        continue

        except Exception:
            continue

    candidates.sort(
        key=lambda x: x["score"],
        reverse=True
    )

    return candidates


# ============================================================
# FIELD EXTRACTION
# ============================================================

def extract_weight_from_label(text, labels):
    """
    Search for a weight next to a label.

    Examples:
        GROSS WEIGHT : 11,580 KG
        GROSS_WT : 11580 KG
        GROSS WT 11580
        G.WT : 11580
        TARE WEIGHT : 4860 KG
        NET WEIGHT : 6720 KG
    """

    if not text:
        return None

    normalized = normalize_ocr_text(text)

    # OCR can split words into different lines.
    compact = re.sub(
        r"\s+",
        " ",
        normalized.upper()
    )

    for label in labels:

        label_pattern = label.upper()

        # Label followed by optional punctuation and weight
        pattern = (
            rf"{label_pattern}"
            r"(?:\s*[:#=\-]\s*|\s+)"
            r"([0-9][0-9,\s]*(?:\.[0-9]+)?)"
            r"\s*(?:KG|KGS)?"
        )

        match = re.search(
            pattern,
            compact,
            flags=re.I
        )

        if match:
            weight = clean_weight(match.group(1))

            if weight is not None:
                return weight

    # Second pass: inspect individual lines.
    lines = normalized.upper().splitlines()

    for index, line in enumerate(lines):

        for label in labels:

            if label.upper() in line:

                # Current line
                match = re.search(
                    r"([0-9][0-9,\s]*(?:\.[0-9]+)?)\s*(?:KG|KGS)?",
                    line,
                    flags=re.I
                )

                if match:

                    weight = clean_weight(
                        match.group(1)
                    )

                    if weight is not None:
                        return weight

                # Next line
                if index + 1 < len(lines):

                    next_line = lines[index + 1]

                    match = re.search(
                        r"([0-9][0-9,\s]*(?:\.[0-9]+)?)\s*(?:KG|KGS)?",
                        next_line,
                        flags=re.I
                    )

                    if match:

                        weight = clean_weight(
                            match.group(1)
                        )

                        if weight is not None:
                            return weight

    return None


def extract_ticket_number(text):
    """
    Extract weighbridge ticket number.

    Handles:
        Ticket No : MGL00352
        Ticket Number : MGL00352
        TICKET NO 257798
        TKT : WB-88213
    """

    if not text:
        return ""

    normalized = normalize_ocr_text(text)
    upper = normalized.upper()

    patterns = [

        # Ticket Number / Ticket No
        r"(?:TICKET\s*(?:NUMBER|NO|NUM)?|TKT)"
        r"\s*[:#=\-]?\s*"
        r"([A-Z0-9][A-Z0-9_-]{3,30})",

        # Some slips print only "NO:"
        r"\bNO\.?\s*[:#=\-]\s*"
        r"([A-Z0-9][A-Z0-9_-]{3,30})",
    ]

    for pattern in patterns:

        matches = re.findall(
            pattern,
            upper,
            flags=re.I
        )

        for value in matches:

            value = normalize_ticket(value)

            if not value:
                continue

            # Avoid obvious words accidentally captured as ticket.
            bad_values = {
                "WEIGHT",
                "GROSS",
                "TARE",
                "NET",
                "DATE",
                "NAME",
                "NUMBER",
                "VEHICLE",
            }

            if value in bad_values:
                continue

            return value

    return ""


def extract_vehicle_registration(text):
    """
    Extract vehicle registration from OCR.

    Example:
        VEHICLE NO : KAS123A
        VEHICLE REG : KAS 123A
        VEHICLE REGISTRATION : KDA123A
    """

    if not text:
        return ""

    normalized = normalize_ocr_text(text)
    upper = normalized.upper()

    patterns = [

        r"(?:VEHICLE\s*(?:NO|NUMBER|REG|REGISTRATION)?"
        r"|VEH|TRUCK)"
        r"\s*[:#=\-]?\s*"
        r"([A-Z]{1,4}\s*[0-9]{1,5}\s*[A-Z]{0,3})",

        r"\b([A-Z]{2,4}\s*[0-9]{2,5}\s*[A-Z])\b",
    ]

    for pattern in patterns:

        match = re.search(
            pattern,
            upper,
            flags=re.I
        )

        if match:

            vehicle = normalize_vehicle(
                match.group(1)
            )

            if len(vehicle) >= 4:
                return vehicle

    return ""


def extract_bag_count(text):
    """
    Extract bag count.

    Handles:
        BAGS : 31
        BAG COUNT : 31
        NO OF BAGS : 31
        BAGS 31
    """

    if not text:
        return None

    normalized = normalize_ocr_text(text)
    upper = normalized.upper()

    patterns = [

        r"(?:BAG\s*COUNT|NO\.?\s*OF\s*BAGS|NUMBER\s*OF\s*BAGS)"
        r"\s*[:#=\-]?\s*(\d{1,5})",

        r"\bBAGS?\s*[:#=\-]?\s*(\d{1,5})",

        r"\bQTY\s*[:#=\-]?\s*(\d{1,5})",

        r"\bPACKETS?\s*[:#=\-]?\s*(\d{1,5})",
    ]

    for pattern in patterns:

        match = re.search(
            pattern,
            upper,
            flags=re.I
        )

        if match:

            value = clean_integer(
                match.group(1)
            )

            if value is not None and 0 < value <= 10000:
                return value

    return None


# ============================================================
# OCR RESULT COMBINATION
# ============================================================

def extract_weighbridge_fields(text):
    """
    Extract all weighbridge fields from OCR text.
    """

    text = normalize_ocr_text(text)

    gross = extract_weight_from_label(
        text,
        [
            r"GROSS\s*(?:WT|WEIGHT)",
            r"GROSS_WT",
            r"GROSS",
            r"G\.?\s*WT",
            r"GW",
        ]
    )

    tare = extract_weight_from_label(
        text,
        [
            r"TARE\s*(?:WT|WEIGHT)",
            r"TARE_WT",
            r"TARE",
            r"T\.?\s*WT",
            r"TW",
        ]
    )

    net = extract_weight_from_label(
        text,
        [
            r"NET\s*(?:WT|WEIGHT)",
            r"NET_WT",
            r"NET",
            r"N\.?\s*WT",
            r"NW",
        ]
    )

    ticket = extract_ticket_number(text)

    vehicle = extract_vehicle_registration(text)

    bags = extract_bag_count(text)

    # Calculate net if gross and tare are available.
    calculated_net = None

    if gross is not None and tare is not None:
        calculated_net = max(
            0,
            gross - tare
        )

    # If OCR did not find printed net weight,
    # use calculated net.
    if net is None and calculated_net is not None:
        net = calculated_net

    return {
        "gross_weight_kg": gross or 0,
        "tare_weight_kg": tare or 0,
        "net_weight_kg": net or 0,
        "bag_count": bags or 0,
        "weighbridge_ticket_number": ticket or "",
        "vehicle_registration": vehicle or "",
    }


# ============================================================
# IMAGE OCR
# ============================================================

def extract_weighbridge_from_image(image_bytes):
    """
    OCR a weighbridge image.

    Multiple rotations and preprocessing methods are tried.
    """

    try:

        image = Image.open(
            io.BytesIO(image_bytes)
        )

        candidates = get_ocr_candidates(image)

        if not candidates:
            return {
                "data": {
                    "gross_weight_kg": 0,
                    "tare_weight_kg": 0,
                    "net_weight_kg": 0,
                    "bag_count": 0,
                    "weighbridge_ticket_number": "",
                    "vehicle_registration": "",
                },
                "text": "",
            }

        # Combine top OCR results.
        #
        # This is important because one OCR version may read
        # "GROSS" correctly while another reads the number correctly.
        top_candidates = candidates[:8]

        combined_text = "\n".join(
            candidate["text"]
            for candidate in top_candidates
        )

        data = extract_weighbridge_fields(
            combined_text
        )

        return {
            "data": data,
            "text": combined_text,
        }

    except Exception:

        frappe.log_error(
            frappe.get_traceback(),
            "Weighbridge Image OCR Error"
        )

        return {
            "data": {
                "gross_weight_kg": 0,
                "tare_weight_kg": 0,
                "net_weight_kg": 0,
                "bag_count": 0,
                "weighbridge_ticket_number": "",
                "vehicle_registration": "",
            },
            "text": "",
        }


# ============================================================
# PDF OCR
# ============================================================

def extract_weighbridge_from_pdf(pdf_bytes):
    """
    First try the PDF text layer.
    If that fails, render PDF pages and perform OCR.
    """

    try:

        pdf_file = io.BytesIO(pdf_bytes)

        reader = PdfReader(pdf_file)

        all_text = ""

        for page in reader.pages:

            page_text = page.extract_text() or ""

            all_text += "\n" + page_text

        all_text = normalize_ocr_text(
            all_text
        )

        data = extract_weighbridge_fields(
            all_text
        )

        # If useful fields were found, return them.
        if (
            data["gross_weight_kg"]
            or data["tare_weight_kg"]
            or data["net_weight_kg"]
            or data["weighbridge_ticket_number"]
        ):

            return {
                "data": data,
                "text": all_text,
            }

        # ----------------------------------------------------
        # PDF OCR fallback
        # ----------------------------------------------------

        from pdf2image import convert_from_bytes

        pages = convert_from_bytes(
            pdf_bytes,
            dpi=300
        )

        all_ocr_text = ""

        for page_image in pages:

            result = extract_weighbridge_from_image(
                io.BytesIO(
                    _image_to_bytes(page_image)
                ).getvalue()
            )

            page_data = result["data"]

            all_ocr_text += "\n" + result["text"]

            # Return immediately if meaningful data exists.
            if (
                page_data["gross_weight_kg"]
                or page_data["tare_weight_kg"]
                or page_data["weighbridge_ticket_number"]
            ):
                return result

        final_data = extract_weighbridge_fields(
            all_ocr_text
        )

        return {
            "data": final_data,
            "text": all_ocr_text,
        }

    except Exception:

        frappe.log_error(
            frappe.get_traceback(),
            "Weighbridge PDF OCR Error"
        )

        return {
            "data": {
                "gross_weight_kg": 0,
                "tare_weight_kg": 0,
                "net_weight_kg": 0,
                "bag_count": 0,
                "weighbridge_ticket_number": "",
                "vehicle_registration": "",
            },
            "text": "",
        }


def _image_to_bytes(image):
    """
    Convert PIL Image to JPEG bytes.
    """

    buffer = io.BytesIO()

    image.save(
        buffer,
        format="JPEG",
        quality=95
    )

    return buffer.getvalue()


# ============================================================
# MAIN FRAPPE API
# ============================================================

@frappe.whitelist()
def extract_weighbridge_slip(filedata, filename=None):
    """
    Frappe API endpoint.

    Receives:
        base64 filedata
        filename

    Returns:
        {
            gross_weight_kg,
            tare_weight_kg,
            net_weight_kg,
            bag_count,
            weighbridge_ticket_number,
            vehicle_registration
        }
    """

    try:

        if not filedata:
            return {
                "error": "No file data received."
            }

        if "," in filedata:
            filedata = filedata.split(
                ",",
                1
            )[1]

        try:
            binary_data = base64.b64decode(
                filedata,
                validate=False
            )
        except Exception:
            return {
                "error": "Invalid base64 file data."
            }

        if not binary_data:
            return {
                "error": "Empty uploaded file."
            }

        filename_lower = (
            filename or ""
        ).lower()

        if filename_lower.endswith(".pdf"):

            result = extract_weighbridge_from_pdf(
                binary_data
            )

        else:

            result = extract_weighbridge_from_image(
                binary_data
            )

        data = result.get(
            "data",
            {}
        )

        gross = clean_weight(
            data.get("gross_weight_kg")
        ) or 0

        tare = clean_weight(
            data.get("tare_weight_kg")
        ) or 0

        net = clean_weight(
            data.get("net_weight_kg")
        ) or 0

        bags = clean_integer(
            data.get("bag_count")
        ) or 0

        ticket = normalize_ticket(
            data.get(
                "weighbridge_ticket_number"
            )
        )

        vehicle = normalize_vehicle(
            data.get(
                "vehicle_registration"
            )
        )

        if gross > 0 and tare > 0:

            calculated_net = max(
                0,
                gross - tare
            )

            net = calculated_net

        response = {
            "gross_weight_kg": gross,
            "tare_weight_kg": tare,
            "net_weight_kg": net,
            "bag_count": bags,
            "weighbridge_ticket_number": ticket,
            "vehicle_registration": vehicle,
        }

        frappe.logger().info(
            "WEIGHBRIDGE OCR RESULT: "
            + str(response)
        )

        return response

    except Exception as e:

        frappe.log_error(
            frappe.get_traceback(),
            "Weighbridge OCR Extraction Error"
        )

        return {
            "error": str(e)
        }