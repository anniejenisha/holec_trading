frappe.ui.form.on('Payment Approval Queue', {
    refresh(frm) {
        frm.set_query('payment_type', () => {
            return {
                filters: {
                    "type": "Bank"
                }
            };
        });
        frm.set_query('payee', () => {
            return {
                filters: {
                    "customer_group": "Holec Trading"
                }
            };
        });
        frm.set_query('account', () => {
            return {
                filters: {
                    "company":frm.doc.company
                }
            };
        });
    }
});