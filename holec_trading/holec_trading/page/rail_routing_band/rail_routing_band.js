frappe.pages['rail_routing_band'].on_page_load = function(wrapper) {
    const doctype = 'Rail Routing Band';

    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __(doctype),
        single_column: true
    });

    // Primary action button
    page.set_primary_action(__('Add ' + doctype), () => {
        frappe.new_doc(doctype);
    }, 'octicon octicon-plus');

    // Route to standard Frappe List view
    page.add_inner_button(__('Full List'), () => {
        frappe.set_route('List', doctype);
    });

    // Full-width container layout
    let $container = $(`
        <div class="card p-3 shadow-sm border-0" id="doctype-view-container">
            <div id="doctype-list-wrapper">
                <div class="text-center py-5 text-muted">
                    <i class="fa fa-spinner fa-spin"></i> ${__('Loading records...')}
                </div>
            </div>
        </div>
    `).appendTo(page.main);

    // Fetch meta & load list
    frappe.model.with_doctype(doctype, function() {
        let meta = frappe.get_meta(doctype);
        let columns = ['name'];

        // Fetch standard list view fields
        meta.fields
            .filter(f => f.in_list_view && f.fieldtype !== 'Table')
            .slice(0, 5)
            .forEach(f => {
                columns.push(f.fieldname);
            });
        columns.push('modified');

        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: doctype,
                fields: columns,
                limit_page_length: 20,
                order_by: 'modified desc'
            },
            callback: function(r) {
                let data = r.message || [];
                render_table($container.find('#doctype-list-wrapper'), doctype, columns, data);
            }
        });
    });

    function render_table($parent, doctype, columns, data) {
        if (!data.length) {
            $parent.html(`
                <div class="text-center text-muted py-5">
                    <i class="fa fa-folder-open-o fa-2x mb-2 d-block"></i>
                    <p class="mb-0">${__('No records found for')} <strong>${__(doctype)}</strong></p>
                </div>
            `);
            return;
        }

        let table_html = `
            <div class="table-responsive">
                <table class="table table-hover mb-0">
                    <thead class="thead-light">
                        <tr>
                            ${columns.map(c => `<th>${frappe.unscrub(c)}</th>`).join('')}
                            <th class="text-center" style="width: 100px;">${__('Action')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(row => `
                            <tr>
                                ${columns.map(c => `<td>${row[c] !== null && row[c] !== undefined ? row[c] : '-'}</td>`).join('')}
                                <td class="text-center">
                                    <a href="/app/${frappe.router.slug(doctype)}/${encodeURIComponent(row.name)}" class="btn btn-xs btn-outline-primary">
                                        ${__('Open')}
                                    </a>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        $parent.html(table_html);
    }
};