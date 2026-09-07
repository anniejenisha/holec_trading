# Copyright (c) 2026, Holec and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from holec_trading.api import execute_payment_approval

class PaymentApprovalQueue(Document):
    def after_insert(self):
        """Automatically triggers bank transfer execution when a pending approval queue record is saved."""
        if self.status == "Pending":
            try:
                execute_payment_approval(self.name)
            except Exception as e:
                frappe.log_error(frappe.get_traceback(), f"Auto Execution Failed for {self.name}")