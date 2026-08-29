frappe.pages['lot_'].on_page_load = function(wrapper) {
    let page = frappe.ui.make_app_page({ parent: wrapper, single_column: true });
    $(wrapper).find('.page-head').hide();
    $(frappe.render_template('lot_', {})).appendTo(page.main);

    let activeState = 'All';

    function loadLots() {
        frappe.call({
            method: 'holec_trading.holec_trading.page.lot_.lot_.get_lots_data',
            args: { state_filter: activeState },
            callback: function(r) {
                if (!r.message) return;
                const { lots, counts } = r.message;

                $('#badge-total-count').text(counts.All || 0);
                $('#count-ticket').text(counts.Ticket || 0);
                $('#count-intake').text(counts.Intake || 0);
                $('#count-lot').text(counts.Lot || 0);
                $('#count-position').text(counts.Position || 0);
                $('#count-invoiced').text(counts.Invoiced || 0);
                $('#count-settled').text(counts.Settled || 0);

                if (!lots.length) {
                    $('#lots-table-body').html(`
                        <tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No lots found for state: <strong>${activeState}</strong></td></tr>
                    `);
                    return;
                }

                let html = lots.map(row => {
                    let stateClass = (row.state || 'Ticket').toLowerCase();
                    let origin = (row.origin_county && row.origin_area) 
                        ? `${row.origin_county} &middot; ${row.origin_area}` 
                        : (row.origin_county || row.origin_area || '&mdash;');
                    let qty = row.quantity ? `${frappe.format(row.quantity, {fieldtype: 'Float'})} kg` : '&mdash;';

                    return `
                        <tr>
                            <td><a href="/app/buy_ticket" style="color: #0f172a; text-decoration: none;">${row.ticket || '&mdash;'}</a></td>
                            <td><a href="/app/lot/${row.name}" style="color: #0f172a; font-weight: 500; text-decoration: none;">${row.name}</a></td>
                            <td>${row.supplier || '&mdash;'}</td>
                            <td>${origin}</td>
                            <td class="text-right">${qty}</td>
                            <td>
                                <span class="state-badge state-${stateClass}">
                                    <span class="dot"></span> ${row.state || 'Ticket'}
                                </span>
                            </td>
                        </tr>
                    `;
                }).join('');
                $('#lots-table-body').html(html);
            }
        });
    }

    // Filter pill click
    $('#filter-pills-bar').on('click', '.filter-pill', function() {
        $('#filter-pills-bar .filter-pill').removeClass('active');
        $(this).addClass('active');
        activeState = $(this).data('state');
        loadLots();
    });

    // Move to New Ticket Page
    $('#btn-open-new-ticket').on('click', function() {
        frappe.set_route('buy_ticket');
    });

    loadLots();
};