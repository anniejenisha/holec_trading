import base64
import hashlib
import json
import logging
import time
import rsa
import rsa.core
import requests
from cryptography.hazmat.primitives.serialization import load_pem_public_key
import frappe
from frappe.utils import getdate
from erpnext.accounts.party import get_party_account

import re

UNIDENTIFIED_CUSTOMER = "Unidentified Customer"  # adjust to your actual placeholder Customer name

# --- paymentType -> Mode of Payment -------------------------------------------------
# 1:1 map - each paymentType has its own dedicated Mode of Payment record in
# ERPNext (create these under Accounting > Mode of Payment before going live).
#
# PesalinkPayment is intentionally NOT in this map - it resolves to one of
# two modes (account vs mobile destination) via _resolve_pesalink_mode()
# below, since a single paymentType covers both subtypes.
PAYMENT_TYPE_MODE_MAP = {
    "WithinBankAccountTransfer": "Bank Transfer",
    "RTGSPayment": "RTGS",
    "EFTPayment": "EFT",
    "ITAXPayment": "iTax",
    "SWIFTPayment": "SWIFT",
    "MpesaPayment": "M-PESA",
    "AirtelPayment": "Airtel",
    "UtilityPayment": "Utility Payment",
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
    destination_type = additions.get("destinationType")  # if the bank sends it explicitly
    if destination_type:
        return destination_type, additions.get("destinationValue")

    if additions.get("mobileNumber") or additions.get("msisdn"):
        return "mobile", additions.get("mobileNumber") or additions.get("msisdn")

    if additions.get("accountNumber"):
        return "account", additions.get("accountNumber")

    return None, None


def _resolve_mode_of_payment(payment_type, additions, bank_acc_doc):
    """
    Resolve the Mode of Payment for this transaction.

    Priority:
      1. An explicit override configured on the Bank Account
         (custom_mode_of_payment) - lets a specific channel/Bank Account
         force a particular Mode of Payment without a code change (e.g. if
         a new dedicated Mpesa paybill is added later).
      2. Pesalink special-case: resolved via account/mobile subtype.
      3. The static PAYMENT_TYPE_MODE_MAP for everything else.

    Returns (mode_of_payment, pesalink_note_or_None).
    """
    override = bank_acc_doc.get("custom_mode_of_payment")
    if override:
        return override, None

    if payment_type == "PesalinkPayment":
        subtype, identifier = _resolve_pesalink_subtype(additions)
        mode = PESALINK_MODE_MAP.get(subtype)
        if subtype:
            note = f"Pesalink via {subtype}" + (f" ({identifier})" if identifier else "")
        else:
            note = "Pesalink - destination subtype (account/mobile) not provided by bank"
        return mode, note

    return PAYMENT_TYPE_MODE_MAP.get(payment_type), None


@frappe.whitelist(allow_guest=True)
def receive_payment():
    """Incoming payment hook processing requests by parsing shortCode from the URL path."""
    try:
        # --- Body parsing: don't rely on get_json(), which raises 415 if the
        # caller's Content-Type header isn't exactly 'application/json'. ---
        raw_body = frappe.request.get_data(as_text=True)
        if not raw_body:
            return {"resultCode": 1, "resultDesc": "Request body is empty"}

        try:
            data = json.loads(raw_body)
        except (ValueError, TypeError):
            frappe.log_error(raw_body, "Treasury Payment API - Invalid JSON body")
            return {"resultCode": 1, "resultDesc": "Request body is not valid JSON"}

        if not isinstance(data, dict):
            return {"resultCode": 1, "resultDesc": "Request body must be a JSON object"}

        # --- shortCode: URL only, never trust payload for this ---
        raw_path = frappe.request.path.split("?")[0].split("#")[0]
        path_parts = [p for p in raw_path.split("/") if p]
        short_code = path_parts[-1] if path_parts else None

        for key in ("shortCode", "channelId", "channel"):
            data.pop(key, None)

        payment_type = data.get("paymentType")
        transaction_reference = data.get("transactionReference")
        transaction_date = data.get("transactionDate")
        amount = data.get("amount")
        currency = data.get("currency")

        company = data.get("company") or data.get("companyName")
        additions = data.get("additions") or {}
        customer_ref = additions.get("customerRef")

        if not transaction_reference:
            return {"resultCode": 1, "resultDesc": "transactionReference is required"}
        if not amount:
            return {"resultCode": 1, "resultDesc": "amount is required"}
        if not payment_type:
            return {"resultCode": 1, "resultDesc": "paymentType is required"}

        if not short_code or short_code == "receive_payment":
            return {"resultCode": 1, "resultDesc": "shortCode missing from URL path"}

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
            return {"resultCode": 1, "resultDesc": "Company could not be determined from URL shortCode mapping."}

        if not paid_to:
            return {"resultCode": 1, "resultDesc": f"Bank Account '{bank_account_name}' has no linked GL Account set (paid_to)."}

        existing_payment = frappe.db.get_value("Payment Entry", {"reference_no": transaction_reference}, "name")
        if existing_payment:
            return {"resultCode": 0, "resultDesc": "Payment already processed", "erpRefId": existing_payment}

        # --- Mode of Payment resolution ---
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
                "resultDesc": f"Mode of Payment '{mode_of_payment}' (mapped from paymentType '{payment_type}') "
                              f"does not exist in the system"
            }

        # --- Customer validation: non-strict ---
        customer = None
        unmatched = False
        if customer_ref:
            customer = frappe.db.get_value("Customer", {"alias": customer_ref}, "name")

        if not customer:
            customer = frappe.db.get_value("Customer", {"name": UNIDENTIFIED_CUSTOMER}, "name")
            unmatched = True
            if not customer:
                return {
                    "resultCode": 1,
                    "resultDesc": f"Customer not found for ref '{customer_ref}' and no fallback "
                                  f"'{UNIDENTIFIED_CUSTOMER}' customer configured"
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
        payment_entry.posting_date = getdate(transaction_date)
        payment_entry.mode_of_payment = mode_of_payment
        payment_entry.party_type = "Customer"
        payment_entry.party = customer
        payment_entry.paid_from = paid_from
        payment_entry.paid_to = paid_to
        payment_entry.paid_amount = amount
        payment_entry.received_amount = amount
        payment_entry.source_exchange_rate = 1
        payment_entry.target_exchange_rate = 1
        payment_entry.reference_no = transaction_reference
        payment_entry.reference_date = getdate(transaction_date)

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

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Treasury Payment API Error")
        return {"resultCode": 1, "resultDesc": str(e)}