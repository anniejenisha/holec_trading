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


@frappe.whitelist(allow_guest=True)
def receive_payment():
    """Incoming payment hook processing requests by parsing shortCode from the URL path."""
    try:
        data = frappe.request.get_json()
        if not data:
            return {"resultCode": 1, "resultDesc": "Request body is empty"}

        # --- shortCode: URL only, never trust payload for this ---
        # Strip query string / fragment defensively, then take the last non-empty segment.
        raw_path = frappe.request.path.split("?")[0].split("#")[0]
        path_parts = [p for p in raw_path.split("/") if p]
        short_code = path_parts[-1] if path_parts else None

        # Explicitly ignore any channel/shortCode-like key a bank might include in the body —
        # channel identity must only ever come from the endpoint the bank was configured to call.
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
        # customer_ref is no longer strictly required to *match* a Customer,
        # but we still want banks to send it for reconciliation purposes.

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

        existing_payment = frappe.db.get_value("Payment Entry", {"reference_no": transaction_reference}, "name")
        if existing_payment:
            return {"resultCode": 0, "resultDesc": "Payment already processed", "erpRefId": existing_payment}

        # --- Customer validation: non-strict ---
        # Not all customers will exist locally yet (sync lag). Rather than rejecting
        # the payment — and risking the bank not retrying / the money going untracked —
        # fall back to a suspense customer and record the raw ref for reconciliation.
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
        payment_entry.mode_of_payment = "Bank Transfer"
        payment_entry.party_type = "Customer"
        payment_entry.party = customer
        payment_entry.paid_from = paid_from
        payment_entry.paid_to = paid_to
        payment_entry.paid_amount = amount
        payment_entry.received_amount = amount
        payment_entry.reference_no = transaction_reference
        payment_entry.reference_date = getdate(transaction_date)

        if unmatched and customer_ref:
            payment_entry.remarks = f"Unmatched customerRef: {customer_ref} — needs manual reconciliation"

        payment_entry.insert(ignore_permissions=True)
        payment_entry.submit()

        result_desc = "Payment received successfully"
        if unmatched:
            result_desc += " (customer unmatched — posted to suspense, pending reconciliation)"

        return {"resultCode": 0, "resultDesc": result_desc, "erpRefId": payment_entry.name}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Treasury Payment API Error")
        return {"resultCode": 1, "resultDesc": str(e)}