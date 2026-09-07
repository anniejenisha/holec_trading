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

logger = logging.getLogger(__name__)

SERVICE_BASE_URL = "https://api.imbank.com/KEPaymentGatewayService/1.0"
TOKEN_URL = "https://api.imbank.com/KEOAuthTokenService/1.0/GetToken"

def _generate_ref_num() -> str:
    return str(int(time.time() * 1000))[-12:]

def _generate_checksum(service_name, channel_id, ref_num, sender_account_no, tran_amount, tran_ccy, public_key_pem) -> str:
    data_str = service_name + channel_id + ref_num + sender_account_no + tran_amount + tran_ccy
    data_bytes = data_str.encode("utf-8")
    crypto_key = load_pem_public_key(public_key_pem.encode("utf-8"))
    pub_numbers = crypto_key.public_numbers()
    n, e, key_size_bytes = pub_numbers.n, pub_numbers.e, crypto_key.key_size // 8
    
    padded = b"\x00" * (key_size_bytes - len(data_bytes)) + data_bytes
    encrypted_int = rsa.core.encrypt_int(int.from_bytes(padded, "big"), e, n)
    encrypted_bytes = encrypted_int.to_bytes(max((encrypted_int.bit_length() + 7) // 8, key_size_bytes), "big")
    
    b64_str = base64.b64encode(encrypted_bytes).decode("utf-8")
    return hashlib.sha256(b64_str.encode("utf-8")).hexdigest()

class IMBankClient:
    def __init__(self, bank_account_doc):
        self.bank_account = bank_account_doc
        self.channel_id = bank_account_doc.get("custom_channel_id") or ""
        raw_creds = bank_account_doc.get("custom_auth_credentials") or "{}"
        self.credentials = json.loads(raw_creds) if isinstance(raw_creds, str) else raw_creds
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})
        self._access_token = None
        self._token_expires_at = 0.0

    def _get_valid_token(self) -> str:
        if self._access_token is None or time.time() >= self._token_expires_at:
            resp = requests.post(TOKEN_URL, data={
                "grant_type": "client_credentials",
                "client_id": self.credentials.get("client_id"),
                "client_secret": self.credentials.get("client_secret"),
            }, timeout=30)
            resp.raise_for_status()
            token_data = resp.json()
            self._access_token = token_data["access_token"]
            self._token_expires_at = time.time() + token_data.get("expires_in", 3600) - 60
        return self._access_token

    def transfer_rtgs(self, sender_account, sender_name, receiver_account, receiver_name, receiver_bic, amount) -> dict:
        ref_num = _generate_ref_num()
        service_name = "RTGSPayment"
        payload = {
            "sender": {"senderAccountNo": sender_account, "senderName": sender_name},
            "receiver": {"receiverAccountNo": receiver_account, "receiverAccountFullName": receiver_name, "receiverBankBICCode": receiver_bic},
            "trandetails": {"transAmount": str(amount), "tranCCY": "KES", "eventID": "FBILL_OUT_RTGS_COMM"}
        }
        headers = {
            "Authorization": f"Bearer {self._get_valid_token()}",
            "serviceName": service_name,
            "requestRefNum": ref_num,
            "initChannelID": self.channel_id,
            "checkSum": _generate_checksum(service_name, self.channel_id, ref_num, sender_account, str(amount), "KES", self.credentials.get("public_key", ""))
        }
        resp = self._session.post(f"{SERVICE_BASE_URL}/MakePayment", json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json()


@frappe.whitelist(allow_guest=True)
def get_approval_queue():
    """Fetches pending approval queue rows as HTML for HTMX frontends or JSON depending on caller requirements."""
    payments = frappe.get_all(
        "Payment Approval Queue",
        filters={"status": "Pending"},
        fields=["name", "company", "payee", "payment_type", "amount", "account", "due_date", "status"]
    )
    
    if not payments:
        return '<tr><td colspan="7" class="text-center text-muted">No pending payments found</td></tr>'
        
    html_rows = ""
    for p in payments:
        html_rows += f"""
        <tr>
            <td>{p.company or ''}</td>
            <td>{p.payee or ''}</td>
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
    """Executes bank transaction when approval is clicked on the portal and creates ERPNext Pay Entry upon success."""
    queue_doc = frappe.get_doc("Payment Approval Queue", docname)
    if queue_doc.status != "Pending":
        frappe.throw("Payment is already processed.")
        
    bank_acc = frappe.get_doc("Bank Account", queue_doc.account)
    client = IMBankClient(bank_acc)
    
    try:
        if queue_doc.payment_type:
            res = client.transfer_rtgs( # Or map to the specific client method if the gateway payload changes
                sender_account=bank_acc.bank_account_no,
                sender_name=queue_doc.company,
                receiver_account=queue_doc.receiver_account,
                receiver_name=queue_doc.receiver_name,
                receiver_bic=queue_doc.receiver_bic,
                amount=str(queue_doc.amount)
            )
        else:
            frappe.throw(f"Unsupported payment type: {queue_doc.payment_type}")

        # Automatically Create Outgoing Payment Entry (Pay)
        paid_from = bank_acc.account
        paid_to = get_party_account(
            party_type="Supplier",
            party=queue_doc.payee,
            company=queue_doc.company
        )
        if not paid_to:
            frappe.throw(f"Payable account not found for supplier {queue_doc.payee} under company {queue_doc.company}")

        payment_entry = frappe.new_doc("Payment Entry")
        payment_entry.payment_type = "Pay"
        payment_entry.company = queue_doc.company
        payment_entry.posting_date = getdate(frappe.utils.nowdate())
        payment_entry.mode_of_payment = queue_doc.payment_type
        payment_entry.party_type = "Supplier"
        payment_entry.party = queue_doc.payee
        payment_entry.paid_from = paid_from
        payment_entry.paid_to = paid_to
        payment_entry.paid_amount = queue_doc.amount
        payment_entry.received_amount = queue_doc.amount
        payment_entry.reference_no = queue_doc.name
        payment_entry.reference_date = getdate(frappe.utils.nowdate())
        payment_entry.insert(ignore_permissions=True)
        payment_entry.submit()

        queue_doc.status = "Completed"
        queue_doc.gateway_response = json.dumps(res)
        queue_doc.save(ignore_permissions=True)
        frappe.db.commit()
        
        return {"status": "success", "response": res, "erpRefId": payment_entry.name}
        
    except Exception as e:
        queue_doc.status = "Failed"
        queue_doc.gateway_response = str(e)
        queue_doc.save(ignore_permissions=True)
        frappe.db.commit()
        raise e


@frappe.whitelist(allow_guest=True)
def receive_payment():
    """Incoming payment hook processing inbound requests extracting shortCode from the URL path."""
    try:
        data = frappe.request.get_json()

        if not data:
            return {"resultCode": 1, "resultDesc": "Request body is empty"}

        payment_type = data.get("paymentType")
        transaction_reference = data.get("transactionReference")
        transaction_date = data.get("transactionDate")
        amount = data.get("amount")
        currency = data.get("currency")

        # Extract short_code from the URL path (e.g., /api/method/.../TRUEGROUP/)
        path_parts = [p for p in frappe.request.path.split("/") if p]
        short_code = path_parts[-1] if path_parts else None

        company = data.get("company") or data.get("companyName")
        additions = data.get("additions") or {}
        customer_ref = additions.get("customerRef")

        if not transaction_reference:
            return {"resultCode": 1, "resultDesc": "transactionReference is required"}

        if not amount:
            return {"resultCode": 1, "resultDesc": "amount is required"}

        if not customer_ref:
            return {"resultCode": 1, "resultDesc": "customerRef is required"}

        # Resolve Company and Bank Account using shortCode from the URL path
        paid_to = None
        if short_code and not company:
            bank_account_name = frappe.db.get_value(
                "Bank Account",
                {"custom_channel_id": short_code},
                "name"
            )
            if bank_account_name:
                bank_acc_doc = frappe.get_doc("Bank Account", bank_account_name)
                paid_to = bank_acc_doc.account
                company = bank_acc_doc.company

        if not company:
            return {"resultCode": 1, "resultDesc": "Company could not be determined from the URL path or payload."}

        if not paid_to:
            return {"resultCode": 1, "resultDesc": f"Bank Account mapping not found for URL shortCode: {short_code}"}

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

        customer = frappe.db.get_value(
            "Customer",
            {"name": customer_ref},
            "name"
        )
        if not customer:
            return {"resultCode": 1, "resultDesc": f"Customer not found: {customer_ref}"}

        paid_from = get_party_account(
            party_type="Customer",
            party=customer,
            company=company
        )
        if not paid_from:
            return {"resultCode": 1, "resultDesc": f"Receivable account not found for {customer} under company {company}"}

        company_currency = frappe.get_cached_value("Company", company, "default_currency")
        if currency and currency != company_currency:
            return {"resultCode": 1, "resultDesc": f"Currency {currency} does not match company currency {company_currency}"}

        # Create Incoming Payment Entry (Receive)
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