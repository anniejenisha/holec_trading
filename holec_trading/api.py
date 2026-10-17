import base64
import hashlib
import json
import logging
import re
import time
import requests
import rsa
import rsa.core
from cryptography.hazmat.primitives.serialization import load_pem_public_key

import frappe
from erpnext.accounts.party import get_party_account
from frappe.utils import cint, flt, getdate, nowdate

UNIDENTIFIED_CUSTOMER = "Unidentified Customer"  # adjust to your actual placeholder Customer name

# --- paymentType -> Mode of Payment -------------------------------------------------
PAYMENT_TYPE_MODE_MAP = {
    "WITHINBANKACCOUNTTRANSFER": "Bank Transfer",
    "WITHINBANKTRANSFER": "Bank Transfer",
    "RTGSPAYMENT": "RTGS",
    "RTGS": "RTGS",
    "EFTPAYMENT": "EFT",
    "EFT": "EFT",
    "ITAXPAYMENT": "iTax",
    "ITAX": "iTax",
    "SWIFTPAYMENT": "SWIFT",
    "SWIFT": "SWIFT",
    "MPESAPAYMENT": "M-PESA",
    "MPESA": "M-PESA",
    "AIRTELPAYMENT": "Airtel",
    "AIRTEL": "Airtel",
    "UTILITYPAYMENT": "Utility Payment",
    "UTILITY": "Utility Payment",
    "OTG": "OTG",
    "BRANCH": "Branch",
    "PESALINK": "Pesalink",
    "PESALINKPAYMENT": "Pesalink",
    "BANKDRAFT": "Bank Draft",
    "WIRETRANSFER": "Wire Transfer",
    "CHEQUE": "Cheque",
    "CASH": "Cash",
    "CREDITCARD": "Credit Card"
}

# Pesalink destination subtype -> Mode of Payment.
PESALINK_MODE_MAP = {
    "account": "Pesalink - Account",
    "mobile": "Pesalink - Mobile",
}


def _resolve_pesalink_subtype(additions):
    """
    Pesalink payments are routed to either a destination account number or
    a destination mobile number. Determine which, plus the identifier used,
    so we can pick the right Mode of Payment and keep the detail for
    reconciliation.
    """
    if not isinstance(additions, dict):
        return None, None

    destination_type = additions.get("destinationType")  # if the bank sends it explicitly
    if destination_type:
        return destination_type, additions.get("destinationValue")

    if additions.get("mobileNumber") or additions.get("msisdn"):
        return "mobile", additions.get("mobileNumber") or additions.get("msisdn")

    if additions.get("accountNumber"):
        return "account", additions.get("accountNumber")

    return None, None


def _ensure_mode_of_payment(mode_name):
    """Ensure the Mode of Payment exists in ERPNext DB; auto-create if missing."""
    if not mode_name:
        return None
    if frappe.db.exists("Mode of Payment", mode_name):
        return mode_name

    # Try creating the Mode of Payment doc in ERPNext
    try:
        doc = frappe.get_doc({
            "doctype": "Mode of Payment",
            "mode_of_payment": mode_name,
            "type": "Bank"
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return mode_name
    except Exception:
        frappe.local.message_log = []

    # Fallback to standard existing Bank Mode of Payment in ERPNext
    for fallback in ("Wire Transfer", "Bank Draft", "Bank Transfer", "Cheque", "M-PESA"):
        if frappe.db.exists("Mode of Payment", fallback):
            return fallback

    return mode_name


def _resolve_mode_of_payment(payment_type, additions, bank_acc_doc):
    """
    Resolve the Mode of Payment for this transaction.

    Priority:
      1. An explicit override configured on the Bank Account (custom_mode_of_payment).
      2. Pesalink special-case: resolved via account/mobile subtype.
      3. The normalized PAYMENT_TYPE_MODE_MAP for everything else.
      4. Case-insensitive / exact match in ERPNext DB.
      5. Intelligent fallback to standard bank modes.

    Returns (mode_of_payment, pesalink_note_or_None).
    """
    if not payment_type:
        return None, None

    override = bank_acc_doc.get("custom_mode_of_payment") if bank_acc_doc else None
    if override:
        return _ensure_mode_of_payment(override), None

    normalized_pt = (payment_type or "").upper().replace(" ", "").replace("-", "").replace("_", "")

    if normalized_pt in ("PESALINKPAYMENT", "PESALINK"):
        subtype, identifier = _resolve_pesalink_subtype(additions or {})
        mode = PESALINK_MODE_MAP.get(subtype)
        if subtype and mode:
            note = f"Pesalink via {subtype}" + (f" ({identifier})" if identifier else "")
            return _ensure_mode_of_payment(mode), note
        else:
            note = "Pesalink - destination subtype (account/mobile) not provided by bank"
            return _ensure_mode_of_payment("Pesalink"), note

    # Map via dictionary
    mapped_mode = PAYMENT_TYPE_MODE_MAP.get(normalized_pt) or PAYMENT_TYPE_MODE_MAP.get(payment_type) or payment_type

    resolved_mode = _ensure_mode_of_payment(mapped_mode)
    return resolved_mode, None


def _is_payment_api_request(req=None):
    if not req:
        req = getattr(frappe, "request", None)
    if not req:
        return False
    path = getattr(req, "path", "") or ""
    cmd = (getattr(frappe.local, "form_dict", {}) or {}).get("cmd") or ""
    endpoints = (
        "holec_trading.api.receive_payment",
        "holec_trading.api.validate_customer",
        "holec_trading.im_bank",
        "im-bank-treasury-callback",
    )
    return any(ep in path for ep in endpoints) or any(ep in str(cmd) for ep in endpoints)


def _enforce_authentication():
    """Enforce authentication on custom API endpoints.
    Rejects any unauthenticated caller (Guest) with HTTP 401 AuthenticationError,
    consistent with Frappe's response when invalid API credentials are provided.
    """
    user = getattr(frappe.session, "user", None)
    if not user or user == "Guest":
        frappe.local.message_log = []
        if hasattr(frappe, "response"):
            for key in ("_server_messages", "__frappe_exc_id", "exc_type", "exc", "_exc_source", "_error_message"):
                frappe.response.pop(key, None)
        frappe.local.response["http_status_code"] = 401
        raise frappe.AuthenticationError("Authentication required")


def check_api_auth():
    """Hook invoked during request authentication (validate_auth).
    Immediately rejects unauthenticated requests to Holec Payment API endpoints
    with HTTP 401 AuthenticationError before handler or whitelisting executes.
    """
    if not _is_payment_api_request():
        return
    if getattr(frappe.session, "user", None) in ("", "Guest", None):
        frappe.local.message_log = []
        raise frappe.AuthenticationError("Authentication required")


def sanitize_api_response(response, request=None):
    """Hook invoked in application finally-block for every request.
    Strips internal debugging fields (_server_messages, __frappe_exc_id, exc_type,
    tracebacks) from any responses on Holec Payment API endpoints.
    Also translates Frappe 417 DataError responses into clean 400 Bad Request responses,
    and ensures clean 401 Authentication required responses without Frappe internal details.
    """
    if not request:
        request = getattr(frappe, "request", None)
    if not request:
        return

    if not _is_payment_api_request(request):
        return

    frappe.local.message_log = []

    if response and getattr(response, "data", None):
        try:
            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type or getattr(response, "mimetype", "") == "application/json":
                data = json.loads(response.data.decode("utf-8"))
                if isinstance(data, dict):
                    dirty = False

                    # Strip verbose internal Frappe error fields
                    for key in (
                        "_server_messages",
                        "__frappe_exc_id",
                        "exc_type",
                        "exc",
                        "_exc_source",
                        "_error_message",
                        "_debug_messages",
                        "exception",
                        "errors",
                    ):
                        if key in data:
                            data.pop(key, None)
                            dirty = True

                    # Translate Frappe's 417 DataError (e.g. malformed JSON in make_form_dict) into clean 400
                    if response.status_code == 417 or data.get("exc_type") in ("DataError", "FrappeTypeError"):
                        response.status_code = 400
                        data = {
                            "resultCode": 1,
                            "resultDesc": "Invalid request",
                            "message": {
                                "resultCode": 1,
                                "resultDesc": "Invalid request"
                            }
                        }
                        dirty = True

                    # Ensure 401 returns clean response without revealing Frappe internal exception names
                    elif response.status_code == 401 or data.get("exc_type") == "AuthenticationError":
                        response.status_code = 401
                        data = {
                            "resultCode": 1,
                            "resultDesc": "Authentication required",
                            "message": {
                                "resultCode": 1,
                                "resultDesc": "Authentication required"
                            }
                        }
                        dirty = True

                    # Translate 500 internal errors into clean generic message
                    elif response.status_code >= 500:
                        response.status_code = 500
                        data = {
                            "resultCode": 1,
                            "resultDesc": "Unable to process payment request",
                            "message": {
                                "resultCode": 1,
                                "resultDesc": "Unable to process payment request"
                            }
                        }
                        dirty = True

                    # Clean any raw Python exception text leaking inside resultDesc (top-level or nested under 'message')
                    target_dicts = [data]
                    if isinstance(data.get("message"), dict):
                        target_dicts.append(data["message"])

                    leak_indicators = (
                        "Traceback",
                        "bad operand type",
                        "TypeError",
                        "ValueError",
                        "KeyError",
                        "AttributeError",
                        "Exception:",
                        "line ",
                        "SyntaxError",
                        "DataError",
                        "OperationalError",
                        "ProgrammingError",
                        "frappe.",
                    )

                    for target in target_dicts:
                        desc = target.get("resultDesc")
                        if isinstance(desc, str) and any(marker in desc for marker in leak_indicators):
                            target["resultDesc"] = "Invalid request"
                            dirty = True

                    if dirty:
                        response.data = json.dumps(data).encode("utf-8")
        except Exception:
            pass



@frappe.whitelist(methods=["POST"])
def receive_payment():
    """Incoming payment hook processing requests by parsing shortCode from the URL path."""
    try:
        _enforce_authentication()

        # --- Body parsing with fallback support ---
        raw_body = frappe.request.get_data(as_text=True)
        if not raw_body and frappe.local.form_dict:
            data = dict(frappe.local.form_dict)
        else:
            if not raw_body or not raw_body.strip():
                return {"resultCode": 1, "resultDesc": "Request body is empty"}
            try:
                data = json.loads(raw_body)
            except (ValueError, TypeError, json.JSONDecodeError):
                frappe.log_error(title="Treasury Payment API - Invalid JSON body", message=raw_body)
                return {"resultCode": 1, "resultDesc": "Request body is not valid JSON"}

        if not isinstance(data, dict):
            return {"resultCode": 1, "resultDesc": "Request body must be a JSON object"}

        # --- shortCode: URL only, never trust payload for this ---
        raw_path = frappe.request.path.split("?")[0].split("#")[0]
        path_parts = [p for p in raw_path.split("/") if p]
        short_code = path_parts[-1] if path_parts else None

        for key in ("shortCode", "channelId", "channel"):
            data.pop(key, None)

        if not short_code or short_code.endswith("receive_payment"):
            return {"resultCode": 1, "resultDesc": "shortCode missing from URL path"}

        # --- Validate and sanitize input fields ---
        payment_type = data.get("paymentType")
        if not payment_type or not isinstance(payment_type, str) or not payment_type.strip():
            return {"resultCode": 1, "resultDesc": "paymentType is required"}
        payment_type = payment_type.strip()

        transaction_reference = data.get("transactionReference")
        if not transaction_reference or not isinstance(transaction_reference, str) or not transaction_reference.strip():
            return {"resultCode": 1, "resultDesc": "transactionReference is required"}
        transaction_reference = transaction_reference.strip()

        # Amount validation: strictly validate positive numeric amount
        amount_raw = data.get("amount")
        if amount_raw is None or amount_raw == "":
            return {"resultCode": 1, "resultDesc": "amount is required"}

        if isinstance(amount_raw, bool):
            return {"resultCode": 1, "resultDesc": "Invalid amount: must be a positive number"}

        try:
            parsed_amount = float(amount_raw)
        except (ValueError, TypeError):
            return {"resultCode": 1, "resultDesc": "Invalid amount: must be a positive number"}

        if parsed_amount <= 0:
            return {"resultCode": 1, "resultDesc": "Invalid amount: must be greater than zero"}

        parsed_amount = round(parsed_amount, 2)

        # Date validation
        transaction_date = data.get("transactionDate")
        if transaction_date:
            try:
                parsed_date = getdate(transaction_date)
            except Exception:
                return {"resultCode": 1, "resultDesc": "Invalid transactionDate format"}
        else:
            parsed_date = getdate(nowdate())

        currency = data.get("currency")
        if currency and (not isinstance(currency, str) or not currency.strip()):
            return {"resultCode": 1, "resultDesc": "Invalid currency format"}
        if currency:
            currency = currency.strip()

        company = data.get("company") or data.get("companyName")
        if company and isinstance(company, str):
            company = company.strip()

        additions = data.get("additions")
        if additions is not None and not isinstance(additions, dict):
            return {"resultCode": 1, "resultDesc": "additions must be a JSON object"}
        additions = additions or {}

        customer_ref = additions.get("customerRef")
        if customer_ref is not None:
            customer_ref = str(customer_ref).strip()

        # Bank Account resolution
        bank_account_name = frappe.db.get_value(
            "Bank Account",
            {"custom_channel_id": short_code},
            "name"
        )
        if not bank_account_name:
            return {"resultCode": 1, "resultDesc": f"Bank Account mapping not found for URL shortCode: {short_code}"}

        bank_acc_doc = frappe.get_doc("Bank Account", bank_account_name)
        paid_to = bank_acc_doc.account
        if not company:
            company = bank_acc_doc.company

        if not company:
            return {"resultCode": 1, "resultDesc": "Company could not be determined from URL shortCode mapping"}

        if not paid_to:
            return {"resultCode": 1, "resultDesc": f"Bank Account '{bank_account_name}' has no linked GL Account set (paid_to)"}

        # Idempotency check
        existing_payment = frappe.db.get_value("Payment Entry", {"reference_no": transaction_reference}, "name")
        if existing_payment:
            return {"resultCode": 0, "resultDesc": "Payment already processed", "erpRefId": existing_payment}

        # Mode of Payment resolution
        mode_of_payment, pesalink_note = _resolve_mode_of_payment(payment_type, additions, bank_acc_doc)
        if not mode_of_payment:
            return {
                "resultCode": 1,
                "resultDesc": f"No Mode of Payment mapping configured for paymentType '{payment_type}'"
                            + (f" ({pesalink_note})" if pesalink_note else "")
            }
        if not frappe.db.exists("Mode of Payment", mode_of_payment):
            return {
                "resultCode": 1,
                "resultDesc": f"Mode of Payment '{mode_of_payment}' does not exist in the system"
            }

        # Customer validation: non-strict
        customer = None
        unmatched = False
        if customer_ref:
            customer = frappe.db.get_value("Customer", {"alias": customer_ref, "disabled": 0}, "name")

        if not customer:
            customer = frappe.db.get_value("Customer", {"name": UNIDENTIFIED_CUSTOMER}, "name")
            unmatched = True
            if not customer:
                return {
                    "resultCode": 1,
                    "resultDesc": f"Customer not found for ref '{customer_ref}' and no fallback '{UNIDENTIFIED_CUSTOMER}' customer configured"
                }

        paid_from = get_party_account(party_type="Customer", party=customer, company=company)
        if not paid_from:
            return {"resultCode": 1, "resultDesc": f"Receivable account not found for {customer} under company {company}"}

        company_currency = frappe.get_cached_value("Company", company, "default_currency")
        if currency and currency != company_currency:
            return {"resultCode": 1, "resultDesc": f"Currency {currency} does not match company currency {company_currency}"}

        payment_entry = frappe.new_doc("Payment Entry")
        payment_entry.payment_type = "Receive"
        payment_entry.company = company
        payment_entry.posting_date = parsed_date
        payment_entry.mode_of_payment = mode_of_payment
        payment_entry.party_type = "Customer"
        payment_entry.party = customer
        payment_entry.paid_from = paid_from
        payment_entry.paid_to = paid_to
        payment_entry.paid_amount = parsed_amount
        payment_entry.received_amount = parsed_amount
        payment_entry.source_exchange_rate = 1
        payment_entry.target_exchange_rate = 1
        payment_entry.reference_no = transaction_reference
        payment_entry.reference_date = parsed_date

        remarks_parts = []
        if unmatched and customer_ref:
            remarks_parts.append(f"Unmatched customerRef: {customer_ref} — needs manual reconciliation")
        if pesalink_note:
            remarks_parts.append(pesalink_note)
        if remarks_parts:
            payment_entry.remarks = " | ".join(remarks_parts)

        payment_entry.insert(ignore_permissions=True)
        payment_entry.submit()

        result_desc = "Payment received successfully"
        if unmatched:
            result_desc += " (customer unmatched — posted to suspense, pending reconciliation)"

        return {"resultCode": 0, "resultDesc": result_desc, "erpRefId": payment_entry.name}

    except frappe.AuthenticationError:
        frappe.local.message_log = []
        raise
    except Exception:
        frappe.log_error(title="Treasury Payment API Error", message=frappe.get_traceback())
        frappe.local.message_log = []
        if hasattr(frappe, "response"):
            for key in ("_server_messages", "__frappe_exc_id", "exc_type", "exc", "_exc_source", "_error_message"):
                frappe.response.pop(key, None)
        return {"resultCode": 1, "resultDesc": "Unable to process payment request"}


@frappe.whitelist(allow_guest=True)
def im_bank_callback():
    try:
        # Safely pull parameters directly from the URL query string
        args = frappe.local.request.args if frappe.local.request else {}
        channel_id = args.get("channel_id")
        secret = args.get("secret")
        
        if not channel_id:
            frappe.local.response["http_status_code"] = 400
            return {"resultCode": 1, "resultDesc": "Missing channel_id"}

        # Find the Bank Account matching this channel_id
        bank_account_name = frappe.db.get_value(
            "Bank Account", 
            {"custom_channel_id": channel_id}, 
            "name"
        )

        if not bank_account_name:
            frappe.local.response["http_status_code"] = 404
            return {"resultCode": 1, "resultDesc": "Unknown channel ID"}

        bank_doc = frappe.get_doc("Bank Account", bank_account_name)
        expected_secret = bank_doc.get_password("custom_webhook_secret")

        # Secure token validation
        if not secret or secret != expected_secret:
            frappe.local.response["http_status_code"] = 403
            return {"resultCode": 1, "resultDesc": "Forbidden: Invalid or missing security token"}

        if frappe.request.method != "POST":
            frappe.local.response["http_status_code"] = 405
            return {"resultCode": 1, "resultDesc": "Only POST is supported"}

        try:
            raw = frappe.request.get_data(as_text=True)
            data = json.loads(raw) if raw else {}
        except Exception:
            frappe.log_error(title="I&M Bank Callback - bad payload", message=frappe.get_traceback())
            frappe.local.response["http_status_code"] = 400
            return {"resultCode": 1, "resultDesc": "Invalid request"}

        ref_num = (
            data.get("requestRefNum")
            or data.get("targetRefNumber")
            or data.get("paymentSystemRefNumber")
        )
        
        if not ref_num:
            frappe.local.response["http_status_code"] = 400
            return {"resultCode": 1, "resultDesc": "Missing reference number in callback"}

        matches = frappe.get_all(
            "Payment Approval Queue",
            filters={"custom_request_ref_num": ref_num},
            pluck="name",
            limit=1,
        )

        if not matches:
            frappe.local.response["http_status_code"] = 404
            return {"resultCode": 1, "resultDesc": "Unknown reference number"}

        doc = frappe.get_doc("Payment Approval Queue", matches[0])
        doc.db_set("gateway_response", json.dumps(data, indent=2))

        response_code = str(data.get("responseCode") or "").upper()

        if response_code in ("SUCCESS", "COMPLETED", "APPROVED", "00", "000"):
            doc.db_set("status", "Completed")
            if not (doc.meta.has_field("custom_payment_entry") and doc.get("custom_payment_entry")):
                try:
                    from holec_trading.www.im_bank_treasury_callback import _create_payment_entry
                    _create_payment_entry(doc, doc.get("account"), data)
                except Exception:
                    frappe.log_error(
                        title=f"I&M Bank Callback: Payment Entry creation failed for {doc.name}",
                        message=frappe.get_traceback(),
                    )
        elif response_code in ("FAILED", "REJECTED", "DECLINED"):
            doc.db_set("status", "Failed")

        frappe.db.commit()
        return {"resultCode": 0, "resultDesc": "Received"}

    except Exception:
        frappe.log_error(title="I&M Bank Callback Error", message=frappe.get_traceback())
        frappe.local.message_log = []
        if hasattr(frappe, "response"):
            for key in ("_server_messages", "__frappe_exc_id", "exc_type", "exc", "_exc_source", "_error_message"):
                frappe.response.pop(key, None)
        frappe.local.response["http_status_code"] = 500
        return {"resultCode": 1, "resultDesc": "Unable to process callback"}


@frappe.whitelist(methods=["POST", "GET"])
def validate_customer():
    """Check whether a customer exists for a given customerRef (alias).

    Expected request body:
        {"customerRef": "C1012"}
    """
    try:
        _enforce_authentication()

        raw_body = frappe.request.get_data(as_text=True)
        try:
            data = json.loads(raw_body) if raw_body else dict(frappe.local.form_dict)
        except (ValueError, TypeError, json.JSONDecodeError):
            return {"resultCode": 1, "resultDesc": "Request body is not valid JSON"}

        if not isinstance(data, dict):
            return {"resultCode": 1, "resultDesc": "Request body must be a JSON object"}

        customer_ref = data.get("customerRef")
        if customer_ref is None or not str(customer_ref).strip():
            return {"resultCode": 1, "resultDesc": "customerRef is required"}

        customer_ref = str(customer_ref).strip()
        if len(customer_ref) > 140:
            return {"resultCode": 1, "resultDesc": "Invalid customerRef"}

        matches = frappe.get_all(
            "Customer",
            filters={"alias": customer_ref, "disabled": 0},
            fields=["name", "customer_name"],
            limit_page_length=2,
        )

        if not matches:
            return {"resultCode": 1, "resultDesc": f"Customer not found for ref '{customer_ref}'"}
        if len(matches) > 1:
            return {"resultCode": 1, "resultDesc": f"Multiple customers share ref '{customer_ref}'"}

        return {
            "resultCode": 0,
            "resultDesc": "Customer found",
            "customerName": matches[0].customer_name,
        }

    except frappe.AuthenticationError:
        frappe.local.message_log = []
        raise
    except Exception:
        frappe.log_error(title="Treasury Customer Validation Error", message=frappe.get_traceback())
        frappe.local.message_log = []
        if hasattr(frappe, "response"):
            for key in ("_server_messages", "__frappe_exc_id", "exc_type", "exc", "_exc_source", "_error_message"):
                frappe.response.pop(key, None)
        return {"resultCode": 1, "resultDesc": "Unable to validate customer"}