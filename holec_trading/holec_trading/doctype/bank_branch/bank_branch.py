# Copyright (c) 2026, Holec
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BankBranch(Document):
	def validate(self):
		if not self.swift_code:
			self.swift_code = frappe.db.get_value("Bank", self.bank, "swift_number")
