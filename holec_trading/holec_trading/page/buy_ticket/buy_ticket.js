frappe.pages['buy_ticket'].on_page_load = function(wrapper) {
    let page = frappe.ui.make_app_page({ parent: wrapper, single_column: true });
    $(wrapper).find('.page-head').hide();
    $(frappe.render_template('buy_ticket', {})).appendTo(page.main);

    // Fetch dropdown values & initial date
    frappe.call({
        method: 'holec_trading.holec_trading.page.buy_ticket.buy_ticket.get_ticket_init_data',
        callback: function(r) {
            if (!r.message) return;
            const { suppliers, unapproved_count, items, today_date } = r.message;

            $('#supplier-unapproved-count').text(unapproved_count);

            let supplierOptions = suppliers.map(s => `
                <option value="${s.name}">${s.supplier_name || s.name} (${s.supplier_group || 'General'})</option>
            `);
            $('#sel-supplier').append(supplierOptions.join(''));

            if (items && items.length) {
                let itemOptions = items.map(i => `<option value="${i.name}">${i.item_name || i.name}</option>`);
                $('#sel-item').html(itemOptions.join(''));
            }

            let todayFormatted = frappe.datetime.str_to_user(today_date || frappe.datetime.get_today());
            $('#inp-delivery-date').val(todayFormatted);
        }
    });

    // Handle form submit
    $('#create-buy-ticket-form').on('submit', function(e) {
        e.preventDefault();

        let supplier = $('#sel-supplier').val();
        let item = $('#sel-item').val();
        let qty = $('#inp-quantity').val();
        let dateVal = $('#inp-delivery-date').val();

        if (!qty) {
            frappe.show_alert({ message: __('Enter an expected quantity'), indicator: 'orange' });
            return;
        }

        frappe.call({
            method: 'holec_trading.holec_trading.page.buy_ticket.buy_ticket.submit_new_ticket',
            args: {
                supplier: supplier,
                item: item,
                expected_qty: qty,
                delivery_date: frappe.datetime.user_to_str(dateVal)
            },
            freeze: true,
            callback: function(r) {
                if (r.message) {
                    frappe.show_alert({ message: __('Ticket created successfully'), indicator: 'green' });
                    // Navigate back to the Lots page
                    frappe.set_route('lot_');
                }
            }
        });
    });

    // Cancel Button
    $('#btn-cancel-ticket').on('click', function() {
        frappe.set_route('lot_');
    });
};