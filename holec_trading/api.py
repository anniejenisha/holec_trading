import json
import frappe
from frappe.utils import getdate
from erpnext.accounts.party import get_party_account
from holec_trading.im_bank_client import IMBankClient


@frappe.whitelist(allow_guest=True)
def get_approval_queue():
    """Fetches pending approval queue rows as HTML for HTMX frontends or JSON depending on caller requirements."""
    payments = frappe.get_all(
        "Payment Approval Queue",
        filters={"status": "Pending"},
        fields=["name", "payee", "payment_type", "amount", "account", "due_date", "status"]
    )
    
    if not payments:
        return '<tr><td colspan="7" class="text-center text-muted">No pending payments found</td></tr>'
        
    html_rows = ""
    for p in payments:
        html_rows += f"""
        <tr>
            <td>{p.payee or ''}</td>
            <td>{p.payment_type or ''}</td>
            <td>{p.payment_type or ''}</td>
            <td>{p.amount or 0.00}</td>
            <td>{p.account or ''}</td>
            <td>{p.due_date or ''}</td>
            <td><span class="badge bg-warning">{p.status}</span></td>
        </tr>
        """
    return html_rows


@frappe.whitelist()
def execute_payment_approval(docname):
    """Executes bank transaction when approval is clicked on the portal."""
    queue_doc = frappe.get_doc("Payment Approval Queue", docname)
    if queue_doc.status != "Pending":
        frappe.throw("Payment is already processed.")
        
    bank_acc = frappe.get_doc("Bank Account", queue_doc.account)
    client = IMBankClient(bank_acc)
    
    try:
        if queue_doc.payment_type == "RTGS":
            res = client.transfer_rtgs(
                sender_account=bank_acc.bank_account_no,
                sender_name=bank_acc.company,
                receiver_account=queue_doc.receiver_account,
                receiver_name=queue_doc.receiver_name,
                receiver_bic=queue_doc.receiver_bic,
                amount=str(queue_doc.amount)
            )
        else:
            frappe.throw(f"Unsupported payment type: {queue_doc.payment_type}")

        queue_doc.status = "Completed"
        queue_doc.gateway_response = json.dumps(res)
        queue_doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"status": "success", "response": res}
        
    except Exception as e:
        queue_doc.status = "Failed"
        queue_doc.gateway_response = str(e)
        queue_doc.save(ignore_permissions=True)
        frappe.db.commit()
        raise e


@frappe.whitelist()
def send_outgoing_payment(queue_docname):
    """
    Outgoing process method: formats and pushes queue payment details outward
    to the bank/treasury gateway and handles response logging.
    """
    queue_doc = frappe.get_doc("Payment Approval Queue", queue_docname)
    
    if queue_doc.status != "Pending":
        return {
            "resultCode": 1,
            "resultDesc": "Payment has already been processed or is not pending."
        }

    bank_acc = frappe.get_doc("Bank Account", queue_doc.account)
    client = IMBankClient(bank_acc)

    try:
        # Build payload matching the required external gateway structure
        payload = {
            "paymentType": queue_doc.payment_type,
            "transactionReference": queue_doc.name,
            "transactionDate": str(frappe.utils.nowdate()),
            "amount": float(queue_doc.amount),
            "currency": "KES",
            "additions": {
                "customerRef": queue_doc.payee,
                "externalRefNumber": getattr(queue_doc, "external_ref", ""),
                "beneficiaryAccount": queue_doc.receiver_account,
                "beneficiaryName": queue_doc.receiver_name,
                "beneficiaryBankBIC": queue_doc.receiver_bic
            }
        }

        # Dispatch via bank client wrapper
        if queue_doc.payment_type == "RTGS":
            res = client.transfer_rtgs(
                sender_account=bank_acc.bank_account_no,
                sender_name=bank_acc.company,
                receiver_account=queue_doc.receiver_account,
                receiver_name=queue_doc.receiver_name,
                receiver_bic=queue_doc.receiver_bic,
                amount=str(queue_doc.amount)
            )
        else:
            return {
                "resultCode": 1,
                "resultDesc": f"Unsupported outgoing payment type: {queue_doc.payment_type}"
            }

        # Update status on success
        queue_doc.status = "Completed"
        queue_doc.gateway_response = json.dumps(res)
        queue_doc.save(ignore_permissions=True)
        frappe.db.commit()

        return {
            "resultCode": 0,
            "resultDesc": "Outgoing payment dispatched successfully",
            "response": res
        }

    except Exception as e:
        queue_doc.status = "Failed"
        queue_doc.gateway_response = str(e)
        queue_doc.save(ignore_permissions=True)
        frappe.db.commit()

        frappe.log_error(frappe.get_traceback(), "Outgoing Treasury Payment Error")
        return {
            "resultCode": 1,
            "resultDesc": str(e)
        }


@frappe.whitelist(allow_guest=True)
def receive_payment():
    """Incoming payment hook processing inbound requests from external sources."""
    try:
        data = frappe.request.get_json()

        if not data:
            return {"resultCode": 1, "resultDesc": "Request body is empty"}

        payment_type = data.get("paymentType")
        transaction_reference = data.get("transactionReference")
        transaction_date = data.get("transactionDate")
        amount = data.get("amount")
        currency = data.get("currency")
        short_code = data.get("shortCode")

        # Extract company from JSON root, or fallback to finding it via shortCode/bank profile
        company = data.get("company") or data.get("companyName")

        additions = data.get("additions") or {}
        customer_ref = additions.get("customerRef")

        if not transaction_reference:
            return {"resultCode": 1, "resultDesc": "transactionReference is required"}

        if not amount:
            return {"resultCode": 1, "resultDesc": "amount is required"}

        if not customer_ref:
            return {"resultCode": 1, "resultDesc": "customerRef is required"}

        # Fallback: If company is missing in JSON, try resolving it via shortCode using Bank Account Profile
        if not company and short_code:
            bank_profile = frappe.db.get_value(
                "Bank Account Profile",
                {"channel_id": short_code}, # Adjust field name if your shortcode maps differently
                "company"
            )
            if bank_profile:
                company = bank_profile

        if not company:
            return {"resultCode": 1, "resultDesc": "Company could not be determined. Please provide 'company' in the JSON payload."}

        # Check duplicate transaction
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

        # Map payment type to ERPNext mode of payment
        payment_mapping = {
            "MPESA": "MPesa",
            "CHEQUE": "Cheque",
            "CASH": "Cash",
            "BANK": "Bank Transfer"
        }
        mode_of_payment = payment_mapping.get(payment_type.upper())
        if not mode_of_payment:
            return {"resultCode": 1, "resultDesc": f"Payment type not supported: {payment_type}"}

        customer = frappe.db.get_value(
            "Customer",
            {"name": customer_ref},
            "name"
        )
        if not customer:
            return {"resultCode": 1, "resultDesc": f"Customer not found: {customer_ref}"}

        # Get Customer Receivable Account for this specific company
        paid_from = get_party_account(
            party_type="Customer",
            party=customer,
            company=company
        )
        if not paid_from:
            return {"resultCode": 1, "resultDesc": f"Receivable account not found for {customer} under company {company}"}

        # Get Bank/Cash Account from Mode of Payment Account table for this company
        paid_to = frappe.db.get_value(
            "Mode of Payment Account",
            {
                "parent": mode_of_payment,
                "company": company
            },
            "default_account"
        )
        if not paid_to:
            return {"resultCode": 1, "resultDesc": f"No account configured for {mode_of_payment} under company {company}"}

        # Currency validation matching company currency
        company_currency = frappe.get_cached_value("Company", company, "default_currency")
        if currency and currency != company_currency:
            return {"resultCode": 1, "resultDesc": f"Currency {currency} does not match company currency {company_currency}"}

        # Create Payment Entry
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
        payment_entry.reference_no = transaction_reference
        payment_entry.reference_date = getdate(transaction_date)

        payment_entry.insert(ignore_permissions=True)

        return {
            "resultCode": 0,
            "resultDesc": "Payment received successfully",
            "erpRefId": payment_entry.name
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Treasury Payment API Error")
        return {
            "resultCode": 1,
            "resultDesc": str(e)
        }