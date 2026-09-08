"""
I&M Bank Treasury API Integration
----------------------------------
App: treasury_integration (custom app) or paste into an existing app's
     integrations module, e.g. apps/your_app/your_app/im_bank/treasury.py

Purpose
-------
Handles the OUTGOING flow from ERPNext -> I&M Bank Treasury API:
  1. Login              -> get access_token (cached 1 hour)
  2. Validate Customer   -> confirm customerRef (non-strict mode)
  3. Process Payment     -> post the transaction

Wire it to your "Payment Approval Queue" doctype's submit event so that
submitting the document (as shown in your screenshot) triggers the call
and writes the result back into `status` and `gateway_response`.

SECURITY NOTE
-------------
Do NOT hardcode auth_username / auth_password / base_url in this file.
Store them in one of:
  a) site_config.json (bench --site yoursite.com set-config im_bank_username "...")
  b) a "IM Bank Settings" single doctype with a Password field (recommended,
     since ERPNext encrypts Password fieldtype values at rest)
This file reads from frappe.conf first, falling back to the settings doctype.
"""

import json
import requests
import frappe
from frappe import _
from frappe.utils import now_datetime

CACHE_KEY = "im_bank_access_token"


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def get_settings():
    """
    Pulls config from site_config.json first, then falls back to a
    Settings singleton doctype (create one called "IM Bank Settings" with
    fields: base_url, channel_id, auth_username, auth_password (Password)).
    """
    conf = frappe.conf

    base_url = conf.get("im_bank_base_url")
    channel_id = conf.get("im_bank_channel_id")
    username = conf.get("im_bank_username")
    password = conf.get("im_bank_password")
    short_code = conf.get("im_bank_short_code")

    if not all([base_url, channel_id, username, password, short_code]):
        # fallback to a settings doctype if you prefer managing this in the UI
        settings = frappe.get_single("IM Bank Settings")
        base_url = base_url or settings.base_url
        channel_id = channel_id or settings.channel_id
        username = username or settings.auth_username
        password = password or settings.get_password("auth_password")
        short_code = short_code or settings.get("short_code")

    if not base_url.endswith("/"):
        base_url += "/"

    return {
        "base_url": base_url,
        "channel_id": channel_id,
        "username": username,
        "password": password,
        "short_code": short_code,
    }


# ---------------------------------------------------------------------------
# 1. Login / token caching
# ---------------------------------------------------------------------------

def get_access_token(force_refresh=False):
    """Returns a cached token, or logs in fresh if expired/missing."""
    if not force_refresh:
        cached = frappe.cache().get_value(CACHE_KEY)
        if cached:
            return cached

    cfg = get_settings()
    url = f"{cfg['base_url']}auth/login/"

    resp = requests.post(
        url,
        json={"username": cfg["username"], "password": cfg["password"]},
        timeout=15,
    )

    if resp.status_code != 200:
        frappe.throw(
            _("I&M Bank login failed ({0}): {1}").format(resp.status_code, resp.text)
        )

    data = resp.json()
    token = data.get("access_token")
    if not token:
        frappe.throw(_("I&M Bank login response did not include access_token"))

    # cache for 55 minutes (token is valid for 1 hour)
    frappe.cache().set_value(CACHE_KEY, token, expires_in_sec=55 * 60)
    return token


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 2. Validate customer
# ---------------------------------------------------------------------------

def validate_customer(customer_ref, retry=True):
    cfg = get_settings()
    token = get_access_token()
    url = f"{cfg['base_url']}payments/validate/{cfg['channel_id']}/"

    resp = requests.post(
        url,
        json={"customerRef": customer_ref},
        headers=_auth_headers(token),
        timeout=15,
    )

    if resp.status_code == 401 and retry:
        # token expired mid-session, refresh once and retry
        get_access_token(force_refresh=True)
        return validate_customer(customer_ref, retry=False)

    return resp.status_code, _safe_json(resp)


# ---------------------------------------------------------------------------
# 3. Process payment
# ---------------------------------------------------------------------------

def process_payment(payload, retry=True):
    """
    payload example:
    {
        "paymentType": "MPESA",
        "transactionReference": "IMB-20260722-0012",
        "transactionDate": "2026-07-22T12:10:00",
        "amount": 15000.00,
        "currency": "KES",
        "shortCode": "123456",
        "additions": {
            "customerRef": "C1012",
            "externalRefNumber": "SGG8129384",
            "payerName": "John Doe",
            "payerMobileNumber": "254712345678"
        }
    }
    """
    cfg = get_settings()
    token = get_access_token()
    url = f"{cfg['base_url']}payments/process/{cfg['channel_id']}/"

    resp = requests.post(url, json=payload, headers=_auth_headers(token), timeout=30)

    if resp.status_code == 401 and retry:
        get_access_token(force_refresh=True)
        return process_payment(payload, retry=False)

    return resp.status_code, _safe_json(resp)


def _safe_json(resp):
    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text}


# ---------------------------------------------------------------------------
# Doc event: hook this to "Payment Approval Queue" on_submit
# ---------------------------------------------------------------------------

def submit_payment_to_bank(doc, method=None):
    """
    hooks.py:
        doc_events = {
            "Payment Approval Queue": {
                "on_submit": "your_app.im_bank.treasury.submit_payment_to_bank"
            }
        }
    """
    try:
        # 1. Validate customer first (non-strict, but still worth logging)
        customer_ref = frappe.db.get_value("Customer",{"name":doc.payee},["alias"])  # map to your actual customer ref field
        v_status, v_body = validate_customer(customer_ref)

        if v_status != 200:
            _mark_failed(doc, f"Validation failed ({v_status}): {json.dumps(v_body)}")
            return

        # 2. Build and send the payment payload
        cfg = get_settings()
        mapped_payment_type = _map_payment_type(doc.payment_type)

        # Only MPESA has a fully documented payload from I&M Bank.
        # Do NOT guess extra fields for other types (RTGS, PesaLink, Cheque)
        # until the bank confirms their required schema - sending undocumented
        # field names just produces confusing, ever-changing rejections.
        DOCUMENTED_PAYMENT_TYPES = {"MPESA"}

        if mapped_payment_type not in DOCUMENTED_PAYMENT_TYPES:
            _mark_failed(
                doc,
                f"Payment type '{mapped_payment_type}' is not yet documented "
                f"by I&M Bank. Only {DOCUMENTED_PAYMENT_TYPES} are confirmed. "
                f"Request the exact payload schema for this type from I&M "
                f"Bank before enabling it here.",
            )
            return

        additions = {
            "customerRef": customer_ref,
            "externalRefNumber": doc.name,
            "payerName": doc.payee,
            "payerMobileNumber": doc.get("payer_mobile_number") or "",
        }

        payload = {
            "paymentType": mapped_payment_type,
            "transactionReference": doc.name,
            "transactionDate": now_datetime().strftime("%Y-%m-%dT%H:%M:%S"),
            "amount": doc.amount,
            "currency": doc.get("currency") or "KES",
            "shortCode": cfg["short_code"],
            "additions": additions,
        }

        p_status, p_body = process_payment(payload)

        if p_status in (200, 201):
            doc.db_set("status", "Completed")
            doc.db_set("gateway_response", json.dumps(p_body, indent=2))
        else:
            _mark_failed(doc, json.dumps(p_body, indent=2))

    except Exception:
        frappe.log_error(frappe.get_traceback(), "I&M Bank Treasury Integration")
        _mark_failed(doc, "Unexpected error - check Error Log")


def _mark_failed(doc, message):
    doc.db_set("status", "Failed")
    doc.db_set("gateway_response", message)


def get_sender_bank_code(doc):
    """
    Walks Payment Approval Queue.account -> Bank Account.bank -> Bank.bank_code
    Adjust 'account' below if your Link fieldname to Bank Account differs.
    """
    bank_account_name = doc.get("account")
    if not bank_account_name:
        return None

    bank_account = frappe.get_doc("Bank Account", bank_account_name)
    if not bank_account.bank:
        return None

    bank = frappe.get_doc("Bank", bank_account.bank)
    # adjust fieldname if your Bank doctype stores this under a different field
    return bank.get("bank_code") or bank.get("swift_number")


def get_sender_account_number(doc):
    """
    Pulls the account number off Payment Approval Queue.account -> Bank Account.bank_account_no
    """
    bank_account_name = doc.get("account")
    if not bank_account_name:
        return None

    bank_account = frappe.get_doc("Bank Account", bank_account_name)
    return bank_account.get("bank_account_no")


def get_sender_branch_code(doc):
    bank_account_name = doc.get("account")
    if not bank_account_name:
        return None

    bank_account = frappe.get_doc("Bank Account", bank_account_name)
    return bank_account.get("branch_code")


def _map_payment_type(erpnext_payment_type):
    """Map your ERPNext Payment Type field values to the bank's enum."""
    mapping = {
        "Bank Draft": "RTGS",
        "M-PESA": "MPESA",
        "Cheque": "CHEQUE",
        "PesaLink": "PESALINK",
    }
    return mapping.get(erpnext_payment_type, erpnext_payment_type)


# ---------------------------------------------------------------------------
# Optional: whitelisted method to trigger manually from a button in the UI
# ---------------------------------------------------------------------------

@frappe.whitelist()
def retry_payment(docname):
    doc = frappe.get_doc("Payment Approval Queue", docname)
    submit_payment_to_bank(doc)
    frappe.msgprint(_("Payment retried. Status: {0}").format(doc.status))