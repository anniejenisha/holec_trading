import frappe
import base64
import io
import re
from pypdf import PdfReader


@frappe.whitelist()
def extract_kra_pin(filedata, filename=None):
    try:
        # Remove the Data URL prefix
        if "," in filedata:
            filedata = filedata.split(",", 1)[1]

        # Decode Base64
        pdf_bytes = base64.b64decode(filedata)

        # Read PDF
        pdf_file = io.BytesIO(pdf_bytes)
        reader = PdfReader(pdf_file)

        # Extract text from all pages
        text = ""

        for page in reader.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"

        # Debug - check extracted text
        frappe.logger().info(f"KRA PDF Text: {text}")

        # KRA PIN format:
        # Example: P051901506U
        match = re.search(
            r'\b[A-Z]\d{9}[A-Z]\b',
            text.upper()
        )

        if match:
            return match.group(0)

        return None

    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "KRA PIN Extraction Error"
        )
        return None