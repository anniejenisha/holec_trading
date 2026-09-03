import frappe
from frappe.utils import getdate
from erpnext.accounts.party import get_party_account


@frappe.whitelist(allow_guest=True)
def receive_payment():

    try:
        # Get Treasury JSON
        data = frappe.request.get_json()

        if not data:
            return {
                "resultCode": 1,
                "resultDesc": "Request body is empty"
            }

        # --------------------------------------------------
        # Treasury fields
        # --------------------------------------------------

        payment_type = data.get("paymentType")
        transaction_reference = data.get("transactionReference")
        transaction_date = data.get("transactionDate")
        amount = data.get("amount")
        currency = data.get("currency")

        additions = data.get("additions") or {}

        customer_ref = additions.get("customerRef")
        external_ref = additions.get("externalRefNumber")
        cheque_number = additions.get("chequeNumber")
        payer_name = additions.get("payerName")

        # --------------------------------------------------
        # Validation
        # --------------------------------------------------

        if not transaction_reference:
            return {
                "resultCode": 1,
                "resultDesc": "transactionReference is required"
            }

        if not amount:
            return {
                "resultCode": 1,
                "resultDesc": "amount is required"
            }

        if not customer_ref:
            return {
                "resultCode": 1,
                "resultDesc": "customerRef is required"
            }

        # --------------------------------------------------
        # Check duplicate transaction
        # --------------------------------------------------

        existing_payment = frappe.db.get_value(
            "Payment Entry",
            {"reference_no": transaction_reference},
            "name"
        )

        if existing_payment:

            return {
                "resultCode": 0,
                "resultDesc": "Payment already processed",
                "erpRefId": existing_payment
            }

        # --------------------------------------------------
        # Company
        # --------------------------------------------------

        company = "Annie Group of Company"

        # --------------------------------------------------
        # Customer
        # --------------------------------------------------

        customer = frappe.db.get_value(
            "Customer",
            {"name": customer_ref},
            "name"
        )

        if not customer:

            return {
                "resultCode": 1,
                "resultDesc": f"Customer not found: {customer_ref}"
            }

        # --------------------------------------------------
        # Customer Receivable Account
        # --------------------------------------------------

        paid_from = get_party_account(
            party_type="Customer",
            party=customer,
            company=company
        )

        if not paid_from:

            return {
                "resultCode": 1,
                "resultDesc": f"Receivable account not found for {customer}"
            }

        # --------------------------------------------------
        # Payment Mode
        # --------------------------------------------------

        if payment_type.upper() == "CHEQUE":

            mode_of_payment = "Cheque"

        else:

            return {
                "resultCode": 1,
                "resultDesc": f"Payment type not supported yet: {payment_type}"
            }

        # --------------------------------------------------
        # Payment Account
        # --------------------------------------------------

        paid_to = frappe.db.get_value(
            "Mode of Payment Account",
            {
                "parent": mode_of_payment,
                "company": company
            },
            "default_account"
        )

        if not paid_to:

            return {
                "resultCode": 1,
                "resultDesc": (
                    f"No account configured for "
                    f"{mode_of_payment} / {company}"
                )
            }

        # --------------------------------------------------
        # Currency check
        # --------------------------------------------------

        if currency and currency != "INR":

            return {
                "resultCode": 1,
                "resultDesc": (
                    f"Currency {currency} does not match "
                    f"company currency INR"
                )
            }

        # --------------------------------------------------
        # Create Payment Entry
        # --------------------------------------------------

        payment_entry = frappe.new_doc("Payment Entry")

        payment_entry.payment_type = "Receive"

        payment_entry.company = company

        payment_entry.posting_date = getdate(transaction_date)

        payment_entry.mode_of_payment = mode_of_payment

        payment_entry.party_type = "Customer"
        payment_entry.party = customer

        # Customer account
        payment_entry.paid_from = paid_from

        # Cash / bank account
        payment_entry.paid_to = paid_to

        payment_entry.paid_amount = amount
        payment_entry.received_amount = amount

        # Treasury transaction reference
        payment_entry.reference_no = transaction_reference
        payment_entry.reference_date = getdate(transaction_date)

        # --------------------------------------------------
        # Insert
        # --------------------------------------------------

        payment_entry.insert(
            ignore_permissions=True
        )

        # --------------------------------------------------
        # Response
        # --------------------------------------------------

        return {
            "resultCode": 0,
            "resultDesc": "Payment received successfully",
            "erpRefId": payment_entry.name
        }

    except Exception as e:

        frappe.log_error(
            frappe.get_traceback(),
            "Treasury Payment API Error"
        )

        return {
            "resultCode": 1,
            "resultDesc": str(e)
        }