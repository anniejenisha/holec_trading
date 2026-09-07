import frappe
import requests
from frappe.model.document import Document

class PaymentApprovalQueue(Document):
    def after_insert(self):
        """Triggered automatically when a Payment Approval Queue document is saved to push data to the portal."""
        try:
            # Map ERPNext document fields to the unified payment specification layout
            payload = {
                "paymentType": self.payment_type.upper() if self.payment_type else "OTG",
                "transactionReference": self.name,
                "transactionDate": str(self.creation),
                "amount": self.amount,
                "currency": frappe.get_cached_value("Company", self.company, "default_currency") or "KES",
                "shortCode": self.get_short_code(),
                "additions": {
                    "customerRef": getattr(self, "customer_ref", "DEFAULT"),
                    "externalRefNumber": self.name,
                    "payerName": self.payee,
                    "senderAccountNumber": self.account,
                    "senderAccountName": self.company
                }
            }

            # Replace with the exact endpoint route provided by the treasury portal provider
            treasury_api_url = "https://treasury.burhaniengineers.com/api/v1/payments" 
            
            headers = {
                "Content-Type": "application/json",
                # Include authentication header if required by the portal (e.g., Bearer token or API key)
                # "Authorization": "Bearer YOUR_ACCESS_TOKEN"
            }

            response = requests.post(treasury_api_url, json=payload, headers=headers, timeout=10)

            if response.status_code in [200, 201]:
                self.db_set("gateway_response", response.text)
            else:
                frappe.log_error(f"Failed to push PAQ {self.name}: Status {response.status_code} - {response.text}", "Portal Sync Error")
                self.db_set("gateway_response", f"Error {response.status_code}: {response.text}")

        except Exception as e:
            frappe.log_error(frappe.get_traceback(), "Portal Sync Exception")
            self.db_set("gateway_response", str(e))

    def get_short_code(self):
        """Fetch the bank account short code mapping."""
        if self.account:
            return frappe.db.get_value("Bank Account", {"account": self.account}, "custom_channel_id") or "123456"
        return "123456"