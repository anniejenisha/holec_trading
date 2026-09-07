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


@frappe.whitelist(allow_guest=True)
def receive_payment():
    """Incoming payment hook processing requests by parsing shortCode from the URL path."""
    try:
        data = frappe.request.get_json()
        if not data:
            return {"resultCode": 1, "resultDesc": "Request body is empty"}

        path_parts = [p for p in frappe.request.path.split("/") if p]
        short_code = path_parts[-1] if path_parts else None

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
        if not customer_ref:
            return {"resultCode": 1, "resultDesc": "customerRef is required"}

        paid_to = None
        if short_code and short_code != "receive_payment":
            bank_account_name = frappe.db.get_value(
                "Bank Account",
                {"custom_channel_id": short_code},
                "name"
            )
            if bank_account_name:
                bank_acc_doc = frappe.get_doc("Bank Account", bank_account_name)
                paid_to = bank_acc_doc.account
                if not company:
                    company = bank_acc_doc.company

        if not company:
            return {"resultCode": 1, "resultDesc": "Company could not be determined from URL path or payload."}
        if not paid_to:
            return {"resultCode": 1, "resultDesc": f"Bank Account mapping not found for URL shortCode: {short_code}"}

        existing_payment = frappe.db.get_value("Payment Entry", {"reference_no": transaction_reference}, "name")
        if existing_payment:
            return {"resultCode": 0, "resultDesc": "Payment already processed", "erpRefId": existing_payment}

        customer = frappe.db.get_value("Customer", {"name": customer_ref}, "name")
        if not customer:
            return {"resultCode": 1, "resultDesc": f"Customer not found: {customer_ref}"}

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

        payment_entry.insert(ignore_permissions=True)
        payment_entry.submit()

        return {"resultCode": 0, "resultDesc": "Payment received successfully", "erpRefId": payment_entry.name}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Treasury Payment API Error")
        return {"resultCode": 1, "resultDesc": str(e)}