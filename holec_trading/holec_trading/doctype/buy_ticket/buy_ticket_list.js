frappe.listview_settings['Buy Ticket'] = {
    hide_name_column: true,

    onload(listview) {
        clean_desk_list_view(listview);
        inject_buy_ticket_portal_styles();
        render_custom_lots_page(listview);
    },

    refresh(listview) {
        clean_desk_list_view(listview);
        render_custom_lots_page(listview);
    }
};

function clean_desk_list_view(listview) {
    $('.desk-sidebar, .layout-side-section, .standard-sidebar-section, .body-sidebar, .page-head, .navbar, #navbar-breadcrumbs, .page-actions, .frappe-list, .page-form').hide();
    
    if (listview && listview.page && listview.page.wrapper) {
        listview.page.wrapper.find('.frappe-list, .page-form, .page-actions, .layout-side-section').hide();
    }
}

function render_custom_lots_page(listview) {
    $('#custom-portal-layout').remove();

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Buy Ticket',
            fields: ['name', 'supplier', 'region', 'quantity_kg', 'status', 'creation', 'modified'],
            order_by: 'creation desc',
            limit_page_length: 500
        },
        callback: function (r) {
            const docs = r.message || [];
            build_portal_dom(listview, docs);
        }
    });
}

function build_portal_dom(listview, docs) {
    const counts = {
        All: docs.length,
        Ticket: docs.filter(d => (d.status || 'Ticket') === 'Ticket').length,
        Intake: docs.filter(d => d.status === 'Intake').length,
        Lot: docs.filter(d => d.status === 'Lot').length,
        Position: docs.filter(d => d.status === 'Position').length,
        Invoiced: docs.filter(d => d.status === 'Invoiced').length,
        Settled: docs.filter(d => d.status === 'Settled').length,
    };

    const user_fullname = frappe.session.user_fullname || 'User';
    const user_abbr = frappe.get_abbr(user_fullname);

    const $portal = $(`
        <div id="custom-portal-layout">
            
            <!-- LEFT SIDEBAR -->
            <div class="holec-sidebar" id="portal_sidebar">
                
                <!-- Logo & Brand Header -->
                <div class="d-flex align-items-center justify-content-between mb-4 px-2">
                    <div class="d-flex align-items-center gap-2">
                        <div class="brand-icon">
                            <i class="fa fa-leaf"></i>
                        </div>
                        <span class="font-weight-bold text-dark sidebar-brand-text" style="font-size: 16px; letter-spacing: -0.2px;">Holec ERP</span>
                    </div>
                    <button class="btn btn-sm btn-link text-muted p-0" id="btn_toggle_sidebar_width" title="Collapse Sidebar">
                        <i class="fa fa-bars" style="font-size: 14px;"></i>
                    </button>
                </div>

                <!-- PARTIES Section (Collapsible) -->
                <div class="sidebar-section mb-2" data-section="parties">
                    <div class="sidebar-header d-flex align-items-center justify-content-between px-2 py-2 cursor-pointer">
                        <span>PARTIES</span>
                        <i class="fa fa-angle-down section-chevron"></i>
                    </div>
                    <div class="sidebar-menu-collapse show">
                        <div class="sidebar-menu">
                            <a href="/app/supplier" class="sidebar-link">
                                <i class="fa fa-users mr-2"></i> <span>Suppliers</span>
                            </a>
                            <a href="/app/customer" class="sidebar-link">
                                <i class="fa fa-university mr-2"></i> <span>Customers</span>
                            </a>
                        </div>
                    </div>
                </div>

                <!-- TRADE Section (Collapsible) -->
                <div class="sidebar-section mb-2" data-section="trade">
                    <div class="sidebar-header d-flex align-items-center justify-content-between px-2 py-2 cursor-pointer">
                        <span>TRADE</span>
                        <i class="fa fa-angle-down section-chevron"></i>
                    </div>
                    <div class="sidebar-menu-collapse show">
                        <div class="sidebar-menu">
                            <a href="javascript:void(0)" class="sidebar-link active">
                                <i class="fa fa-leaf mr-2"></i> <span>Lots</span>
                            </a>
                            <a href="javascript:void(0)" id="sidebar_new_ticket_btn" class="sidebar-link">
                                <i class="fa fa-file-text-o mr-2"></i> <span>New ticket</span>
                            </a>
                            <a href="javascript:void(0)" class="sidebar-link">
                                <i class="fa fa-truck mr-2"></i> <span>Intake & quality</span>
                            </a>
                            <a href="javascript:void(0)" class="sidebar-link">
                                <i class="fa fa-newspaper-o mr-2"></i> <span>Deductions & payable</span>
                            </a>
                            <a href="javascript:void(0)" class="sidebar-link">
                                <i class="fa fa-exchange mr-2"></i> <span>Transport & loss</span>
                            </a>
                            <a href="javascript:void(0)" class="sidebar-link">
                                <i class="fa fa-shopping-cart mr-2"></i> <span>Sale & invoicing</span>
                            </a>
                        </div>
                    </div>
                </div>

                <!-- FINANCE Section (Collapsible) -->
                <div class="sidebar-section mb-2" data-section="finance">
                    <div class="sidebar-header d-flex align-items-center justify-content-between px-2 py-2 cursor-pointer">
                        <span>FINANCE</span>
                        <i class="fa fa-angle-down section-chevron"></i>
                    </div>
                    <div class="sidebar-menu-collapse show">
                        <div class="sidebar-menu">
                            <a href="/app/payment-entry" class="sidebar-link">
                                <i class="fa fa-credit-card mr-2"></i> <span>Payments</span>
                            </a>
                        </div>
                    </div>
                </div>

                <!-- INSIGHT Section (Collapsible) -->
                <div class="sidebar-section mb-2" data-section="insight">
                    <div class="sidebar-header d-flex align-items-center justify-content-between px-2 py-2 cursor-pointer">
                        <span>INSIGHT</span>
                        <i class="fa fa-angle-down section-chevron"></i>
                    </div>
                    <div class="sidebar-menu-collapse show">
                        <div class="sidebar-menu">
                            <a href="javascript:void(0)" class="sidebar-link">
                                <i class="fa fa-bar-chart mr-2"></i> <span>Cost ledger & margin</span>
                            </a>
                            <a href="javascript:void(0)" class="sidebar-link">
                                <i class="fa fa-pie-chart mr-2"></i> <span>Reports</span>
                            </a>
                            <a href="javascript:void(0)" class="sidebar-link">
                                <i class="fa fa-history mr-2"></i> <span>Trade event log</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            <!-- MAIN CONTENT AREA -->
            <div class="holec-main-content">
                <div style="max-width: 1150px; margin: 0 auto;">
                    
                    <!-- Top Navigation & User Info -->
                    <div class="d-flex align-items-center justify-content-between mb-4">
                        <div class="text-muted d-flex align-items-center" style="font-size: 13.5px;">
                            <a href="/app" class="text-muted text-decoration-none mr-2">Desk</a> 
                            <span class="mr-2">/</span>
                            <span class="mr-2">Trade</span>
                            <span class="mr-2">/</span>
                            <strong class="text-dark font-weight-bold">Lots</strong>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <div class="avatar-circle">${user_abbr}</div>
                            <div style="font-size: 12.5px; line-height: 1.2;">
                                <span class="font-weight-bold d-block text-dark">${user_fullname}</span>
                                <span class="text-muted">${frappe.session.user}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stepper Bar -->
                    <div class="stepper-nav d-flex align-items-center gap-2 mb-4">
                        <div class="step-badge"><span class="step-num">1</span> Ticket</div> <span class="step-chevron">›</span>
                        <div class="step-badge"><span class="step-num">2</span> Intake</div> <span class="step-chevron">›</span>
                        <div class="step-badge step-badge-active"><span class="step-num-active">3</span> Lot</div> <span class="step-chevron">›</span>
                        <div class="step-badge"><span class="step-num">4</span> Position</div> <span class="step-chevron">›</span>
                        <div class="step-badge"><span class="step-num">5</span> Invoiced</div> <span class="step-chevron">›</span>
                        <div class="step-badge"><span class="step-num">6</span> Settled</div>
                    </div>

                    <!-- Main Title & Count -->
                    <div class="d-flex align-items-center gap-2 mb-4">
                        <h1 class="font-weight-bold m-0" style="font-size: 24px; color: #0f172a;">Lots</h1>
                        <span class="badge-count" id="total_lots_count">${counts.All}</span>
                    </div>

                    <!-- Filters & Action Bar -->
                    <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-2 filter-tabs-wrapper">
                            <button class="filter-pill-btn active" data-filter="All">All</button>
                            <button class="filter-pill-btn" data-filter="Ticket">Ticket (${counts.Ticket})</button>
                            <button class="filter-pill-btn" data-filter="Intake">Intake (${counts.Intake})</button>
                            <button class="filter-pill-btn" data-filter="Lot">Lot (${counts.Lot})</button>
                            <button class="filter-pill-btn" data-filter="Position">Position (${counts.Position})</button>
                            <button class="filter-pill-btn" data-filter="Invoiced">Invoiced (${counts.Invoiced})</button>
                            <button class="filter-pill-btn" data-filter="Settled">Settled (${counts.Settled})</button>
                        </div>
                        <button id="btn_custom_new_ticket" class="btn text-white font-weight-bold px-3 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                            + New ticket
                        </button>
                    </div>

                    <!-- Lots Table -->
                    <div class="bg-white border rounded-lg overflow-hidden" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <table class="table custom-lots-table mb-0">
                            <thead>
                                <tr>
                                    <th style="width: 14%;">Ticket</th>
                                    <th style="width: 15%;">Lot ID</th>
                                    <th style="width: 25%;">Supplier</th>
                                    <th style="width: 22%;">Origin</th>
                                    <th style="width: 12%; text-align: right;">Quantity</th>
                                    <th style="width: 12%; text-align: right; padding-right: 24px;">State</th>
                                </tr>
                            </thead>
                            <tbody id="custom_lots_tbody"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `);

    $('body').append($portal);
    populate_lots_rows(docs, 'All');

    // Accordion expand/collapse on Section Headers
    $('.sidebar-header').on('click', function () {
        const $section = $(this).closest('.sidebar-section');
        const $menu = $section.find('.sidebar-menu-collapse');
        const $icon = $(this).find('.section-chevron');

        $menu.slideToggle(180, function () {
            if ($menu.is(':visible')) {
                $icon.removeClass('fa-angle-right').addClass('fa-angle-down');
            } else {
                $icon.removeClass('fa-angle-down').addClass('fa-angle-right');
            }
        });
    });

    // Sidebar full collapse / expand toggle
    $('#btn_toggle_sidebar_width').on('click', function () {
        $('#portal_sidebar').toggleClass('collapsed');
    });

    // Filter pill tabs
    $('.filter-pill-btn').on('click', function () {
        $('.filter-pill-btn').removeClass('active');
        $(this).addClass('active');
        populate_lots_rows(docs, $(this).data('filter'));
    });

    // New Ticket triggers
    $('#btn_custom_new_ticket, #sidebar_new_ticket_btn').on('click', () => {
        frappe.new_doc('Buy Ticket');
    });
}

function populate_lots_rows(docs, filter) {
    const $tbody = $('#custom_lots_tbody');
    $tbody.empty();

    const filteredDocs = filter === 'All' ? docs : docs.filter(d => (d.status || 'Ticket') === filter);

    if (filteredDocs.length === 0) {
        $tbody.append(`
            <tr>
                <td colspan="6" class="text-center text-muted py-5" style="font-size: 14px;">
                    No records found for "${filter}".
                </td>
            </tr>
        `);
        return;
    }

    filteredDocs.forEach(d => {
        const state = d.status || 'Ticket';
        const cleanName = (d.name || '').replace(/[^a-zA-Z0-9]/g, '');
        const suffix = cleanName.length >= 5 ? cleanName.slice(-5).toUpperCase() : (cleanName.toUpperCase() || 'QIZ3T');
        const lotId = 'LOT-' + suffix;

        const origin = d.region || '—';
        const formattedQty = d.quantity_kg ? `${Number(d.quantity_kg).toLocaleString()} kg` : '—';
        const badgeClass = get_state_badge_class(state);

        const $row = $(`
            <tr class="lots-data-row" data-name="${d.name}">
                <td class="font-weight-medium text-dark">${d.name}</td>
                <td class="text-muted">${lotId}</td>
                <td class="font-weight-medium text-dark">${d.supplier || '—'}</td>
                <td class="text-muted">${origin}</td>
                <td style="text-align: right;" class="text-dark">${formattedQty}</td>
                <td style="text-align: right; padding-right: 24px;">
                    <span class="lot-state-badge ${badgeClass}">
                        ● ${state}
                    </span>
                </td>
            </tr>
        `);

        $row.on('click', function () {
            frappe.set_route('Form', 'Buy Ticket', d.name);
        });

        $tbody.append($row);
    });
}

function get_state_badge_class(state) {
    switch (state) {
        case 'Intake': return 'badge-intake';
        case 'Lot': return 'badge-lot';
        case 'Position': return 'badge-position';
        case 'Invoiced': return 'badge-invoiced';
        case 'Settled': return 'badge-settled';
        case 'Ticket':
        default: return 'badge-ticket';
    }
}

function inject_buy_ticket_portal_styles() {
    if ($('#custom-buy-ticket-portal-css').length) return;
    $('head').append(`
        <style id="custom-buy-ticket-portal-css">
            #custom-portal-layout {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                width: 100vw;
                height: 100vh;
                z-index: 1020;
                display: flex;
                background-color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow: hidden;
            }

            .holec-sidebar {
                width: 250px;
                min-width: 250px;
                height: 100vh;
                background-color: #ffffff;
                border-right: 1px solid #f1f5f9;
                padding: 20px 16px;
                overflow-y: auto;
                transition: width 0.2s ease, min-width 0.2s ease, padding 0.2s ease;
            }

            .holec-sidebar.collapsed {
                width: 70px;
                min-width: 70px;
                padding: 20px 10px;
            }
            .holec-sidebar.collapsed .sidebar-brand-text,
            .holec-sidebar.collapsed .sidebar-header,
            .holec-sidebar.collapsed .sidebar-link span {
                display: none !important;
            }
            .holec-sidebar.collapsed .sidebar-link {
                justify-content: center;
                padding: 10px 0;
            }
            .holec-sidebar.collapsed .sidebar-link i {
                margin: 0 !important;
                font-size: 16px;
            }

            .holec-main-content {
                flex: 1;
                height: 100vh;
                background-color: #fafbfc;
                padding: 24px 32px;
                overflow-y: auto;
                min-width: 0;
            }

            .brand-icon {
                width: 28px;
                height: 28px;
                background-color: #0f2438;
                color: #ffffff;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
            }

            .cursor-pointer {
                cursor: pointer;
                user-select: none;
            }

            .sidebar-header {
                font-size: 11px;
                font-weight: 700;
                color: #64748b;
                letter-spacing: 0.5px;
                border-radius: 4px;
                transition: background 0.15s ease;
            }
            .sidebar-header:hover {
                background: #f8fafc;
                color: #0f172a;
            }

            .section-chevron {
                font-size: 12px;
                color: #94a3b8;
                transition: transform 0.15s ease;
            }

            .sidebar-link {
                display: flex;
                align-items: center;
                padding: 8px 12px;
                color: #334155;
                font-size: 13.5px;
                font-weight: 500;
                border-radius: 6px;
                text-decoration: none !important;
                transition: all 0.15s ease-in-out;
                margin-bottom: 2px;
            }
            .sidebar-link:hover {
                background-color: #f8fafc;
                color: #0f172a;
            }
            .sidebar-link.active {
                background-color: #e2e8f0;
                color: #0f172a;
                font-weight: 600;
            }
            .sidebar-link i {
                width: 18px;
                text-align: center;
                color: #475569;
            }

            .avatar-circle {
                width: 32px;
                height: 32px;
                background-color: #0f2438;
                color: #ffffff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11.5px;
                font-weight: bold;
            }

            .stepper-nav {
                font-size: 13px;
                color: #64748b;
            }
            .step-badge {
                padding: 4px 10px;
                border-radius: 16px;
                background-color: transparent;
                color: #475569;
                font-weight: 500;
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }
            .step-badge-active {
                background-color: #0f2438;
                color: #ffffff;
            }
            .step-num {
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: #f1f5f9;
                color: #64748b;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
            }
            .step-num-active {
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: #1e3a5f;
                color: #ffffff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
            }
            .step-chevron {
                color: #94a3b8;
                font-size: 14px;
            }
            .badge-count {
                background-color: #f1f5f9;
                color: #64748b;
                font-size: 12px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 12px;
            }
            .filter-pill-btn {
                background-color: #ffffff;
                border: 1px solid #e2e8f0;
                color: #475569;
                font-size: 13px;
                font-weight: 500;
                padding: 6px 14px;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.15s ease-in-out;
            }
            .filter-pill-btn:hover {
                background-color: #f8fafc;
            }
            .filter-pill-btn.active {
                background-color: #0f2438;
                color: #ffffff;
                border-color: #0f2438;
            }

            .custom-lots-table th {
                background-color: #f8fafc;
                color: #0f172a;
                font-size: 13px;
                font-weight: 600;
                border-top: none;
                border-bottom: 1px solid #e2e8f0;
                padding: 12px 16px;
            }
            .custom-lots-table td {
                font-size: 13.5px;
                vertical-align: middle;
                border-bottom: 1px solid #f1f5f9;
                padding: 14px 16px;
            }
            .lots-data-row {
                cursor: pointer;
                transition: background 0.15s ease-in-out;
            }
            .lots-data-row:hover {
                background-color: #f8fafc;
            }

            .lot-state-badge {
                display: inline-block;
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
                line-height: 1;
            }
            .badge-intake { background-color: #fef3c7; color: #d97706; }
            .badge-ticket { background-color: #f1f5f9; color: #475569; }
            .badge-lot { background-color: #e0e7ff; color: #4338ca; }
            .badge-position { background-color: #dbeafe; color: #2563eb; }
            .badge-invoiced { background-color: #fef3c7; color: #b45309; }
            .badge-settled { background-color: #dcfce7; color: #15803d; }
        </style>
    `);
}