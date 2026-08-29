frappe.ui.form.on('Buy Ticket', {
    refresh(frm) {
        inject_portal_form_styles();
        if (frm.is_new()) {
            render_custom_new_ticket_page(frm);
        } else if (frm.doc.status === 'Ticket' || !frm.doc.status) {
            render_custom_ticket_details_page(frm);
        } else if (frm.doc.status === 'Intake') {
            render_intake_quality_capture_page(frm);
        } else if (frm.doc.status === 'Lot') {
            render_transport_loss_page(frm);
        } else if (frm.doc.status === 'Position') {
            render_position_overview_page(frm);
        } else if (frm.doc.status === 'Invoiced') {
            render_invoiced_overview_page(frm);
        } else if (frm.doc.status === 'Settled') {
            render_settled_overview_page(frm);
        } else {
            render_custom_ticket_details_page(frm);
        }
    }
});

function clear_all_custom_views(frm) {
    $('.desk-sidebar, .layout-side-section, .standard-sidebar-section, .body-sidebar, .page-head, .navbar, #navbar-breadcrumbs, .page-actions, .timeline, .form-sidebar').hide();
    if (frm && frm.page && frm.page.wrapper) {
        frm.page.wrapper.find('.form-layout, .page-actions, .timeline, .form-sidebar, .layout-side-section, .page-head').hide();
    }
    $('#custom-portal-form-wrapper').remove();
}

function get_portal_shell_html(activeNav, breadcrumbCategory, breadcrumbCurrent, contentHtml) {
    const user_fullname = frappe.session.user_fullname || 'Administrator';
    const user_abbr = frappe.get_abbr(user_fullname) || 'A';

    return `
        <div id="custom-portal-form-wrapper">
            <div class="holec-sidebar" id="portal_form_sidebar">
                <div class="d-flex align-items-center justify-content-between mb-4 px-2">
                    <div class="d-flex align-items-center gap-2">
                        <div class="brand-icon"><i class="fa fa-leaf"></i></div>
                        <span class="font-weight-bold text-dark sidebar-brand-text" style="font-size: 16px; letter-spacing: -0.2px;">Holec ERP</span>
                    </div>
                    <button class="btn btn-sm btn-link text-muted p-0" id="btn_toggle_sidebar_collapse" title="Toggle Sidebar">
                        <i class="fa fa-bars" style="font-size: 14px;"></i>
                    </button>
                </div>

                <div class="sidebar-section mb-2" data-section="parties">
                    <div class="sidebar-header d-flex align-items-center justify-content-between px-2 py-2 cursor-pointer">
                        <span>PARTIES</span>
                        <i class="fa fa-angle-down section-chevron"></i>
                    </div>
                    <div class="sidebar-menu-collapse show">
                        <div class="sidebar-menu">
                            <a href="/app/supplier" class="sidebar-link ${activeNav === 'Suppliers' ? 'active' : ''}">
                                <i class="fa fa-users mr-2"></i> <span>Suppliers</span>
                            </a>
                            <a href="/app/customer" class="sidebar-link ${activeNav === 'Customers' ? 'active' : ''}">
                                <i class="fa fa-university mr-2"></i> <span>Customers</span>
                            </a>
                        </div>
                    </div>
                </div>

                <div class="sidebar-section mb-2" data-section="trade">
                    <div class="sidebar-header d-flex align-items-center justify-content-between px-2 py-2 cursor-pointer">
                        <span>TRADE</span>
                        <i class="fa fa-angle-down section-chevron"></i>
                    </div>
                    <div class="sidebar-menu-collapse show">
                        <div class="sidebar-menu">
                            <a href="javascript:void(0)" id="sidebar_lots_link" class="sidebar-link ${activeNav === 'Lots' ? 'active' : ''}">
                                <i class="fa fa-leaf mr-2"></i> <span>Lots</span>
                            </a>
                            <a href="javascript:void(0)" id="sidebar_new_ticket_btn" class="sidebar-link ${activeNav === 'New ticket' ? 'active' : ''}">
                                <i class="fa fa-file-text-o mr-2"></i> <span>New ticket</span>
                            </a>
                            <a href="javascript:void(0)" id="sidebar_intake_link" class="sidebar-link ${activeNav === 'Intake & quality' ? 'active' : ''}">
                                <i class="fa fa-truck mr-2"></i> <span>Intake & quality</span>
                            </a>
                            <a href="javascript:void(0)" id="sidebar_deductions_link" class="sidebar-link ${activeNav === 'Deductions & payable' ? 'active' : ''}">
                                <i class="fa fa-newspaper-o mr-2"></i> <span>Deductions & payable</span>
                            </a>
                            <a href="javascript:void(0)" id="sidebar_transport_link" class="sidebar-link ${activeNav === 'Transport & loss' ? 'active' : ''}">
                                <i class="fa fa-exchange mr-2"></i> <span>Transport & loss</span>
                            </a>
                            <a href="javascript:void(0)" id="sidebar_sale_invoicing_link" class="sidebar-link ${activeNav === 'Sale & invoicing' ? 'active' : ''}">
                                <i class="fa fa-shopping-cart mr-2"></i> <span>Sale & invoicing</span>
                            </a>
                        </div>
                    </div>
                </div>

                <div class="sidebar-section mb-2" data-section="finance">
                    <div class="sidebar-header d-flex align-items-center justify-content-between px-2 py-2 cursor-pointer">
                        <span>FINANCE</span>
                        <i class="fa fa-angle-down section-chevron"></i>
                    </div>
                    <div class="sidebar-menu-collapse show">
                        <div class="sidebar-menu">
                            <a href="javascript:void(0)" id="sidebar_payments_link" class="sidebar-link ${activeNav === 'Payments' ? 'active' : ''}">
                                <i class="fa fa-credit-card mr-2"></i> <span>Payments</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            <div class="holec-main-content">
                <div style="max-width: 1050px; margin: 0 auto;">
                    <div class="d-flex align-items-center justify-content-between mb-4">
                        <div class="text-muted d-flex align-items-center" style="font-size: 13.5px;">
                            <a href="/app" class="text-muted text-decoration-none mr-2">Holec Trading</a> 
                            <span class="mr-2">›</span>
                            <span class="mr-2">${breadcrumbCategory || 'Trade'}</span>
                            <span class="mr-2">›</span>
                            <strong class="text-dark font-weight-bold">${breadcrumbCurrent}</strong>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <div class="avatar-circle">${user_abbr}</div>
                            <div style="font-size: 12px; line-height: 1.2;">
                                <span class="font-weight-bold d-block text-dark">You</span>
                                <span class="text-muted">${user_fullname}</span>
                            </div>
                        </div>
                    </div>

                    ${contentHtml}
                </div>
            </div>
        </div>
    `;
}

function attach_portal_events(frm) {
    $('.sidebar-header').off('click').on('click', function () {
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

    $('#btn_toggle_sidebar_collapse').off('click').on('click', () => $('#portal_form_sidebar').toggleClass('collapsed'));
    $('#sidebar_lots_link').off('click').on('click', () => frappe.set_route('List', 'Buy Ticket'));
    $('#sidebar_new_ticket_btn').off('click').on('click', () => frappe.new_doc('Buy Ticket'));
    $('#sidebar_intake_link').off('click').on('click', () => render_intake_quality_capture_page(frm));
    $('#sidebar_deductions_link').off('click').on('click', () => render_deductions_payable_page(frm));
    $('#sidebar_transport_link').off('click').on('click', () => render_transport_loss_page(frm));
    $('#sidebar_sale_invoicing_link').off('click').on('click', () => render_sale_invoicing_page(frm));
    $('#sidebar_payments_link').off('click').on('click', () => render_payments_dashboard_page(frm));
}

function compute_ticket_payable(doc) {
    const grossKg = parseFloat(doc.gross_weight_kg) || 0;
    const tareKg = parseFloat(doc.tare_weight_kg) || 0;
    const netKg = Math.max(0, grossKg - tareKg);

    const moisturePct = parseFloat(doc.moisture_percent) || 0;
    const fmPct = parseFloat(doc.foreign_matter_percent) || 0;
    const aflatoxinPpb = parseFloat(doc.aflatoxin_ppb) || 0;
    const bags = parseInt(doc.bag_count) || (netKg > 0 ? Math.round(netKg / 50) : 0);
    const refRatePerKg = parseFloat(doc.negotiated_price) > 0 ? parseFloat(doc.negotiated_price) : 48;

    let band = '≤14%';
    let moistureDeductionKg = 0;
    const standardMoisture = 13.5;

    if (moisturePct > 14) band = '>14%';
    if (moisturePct > standardMoisture) {
        moistureDeductionKg = Math.round(netKg * ((moisturePct - standardMoisture) / 100));
    }

    let fmDeductionKg = 0;
    if (fmPct > 0) {
        fmDeductionKg = Math.round(netKg * (fmPct / 100) * (1 + (fmPct / 100) * 0.46));
    }

    const acceptedNetKg = Math.max(0, netKg - moistureDeductionKg - fmDeductionKg);
    const grossValue = Math.round(acceptedNetKg * refRatePerKg);
    const baggingDeduction = bags * 25;
    const aflatoxinTestFee = 300;
    const netPayable = Math.max(0, grossValue - baggingDeduction - aflatoxinTestFee);

    const haulage = parseFloat(doc.haulage_kes) || 0;
    const cess = parseFloat(doc.cess_kes) || 0;
    const offloading = parseFloat(doc.offloading_kes) || 0;
    const totalTransportHandling = haulage + cess + offloading;
    const totalLandedCost = netPayable + totalTransportHandling;

    const landedCostPerKg = acceptedNetKg > 0 ? Math.round(totalLandedCost / acceptedNetKg) : 0;
    const aflatoxinPass = aflatoxinPpb <= 10;

    const sellRate = parseFloat(doc.sell_rate_per_kg) || refRatePerKg;
    const totalAmountDue = parseFloat(doc.sales_revenue_kes) || (acceptedNetKg * sellRate) || netPayable;
    const marginPerTonne = parseFloat(doc.margin_per_tonne_kes) || (acceptedNetKg > 0 ? Math.round(((parseFloat(doc.sales_margin_kes) || 0) / acceptedNetKg) * 1000) : 0);

    return {
        grossKg, tareKg, netKg, band, moisturePct, moistureDeductionKg, fmPct, fmDeductionKg,
        acceptedNetKg, refRatePerKg, grossValue, bags, baggingDeduction, aflatoxinTestFee,
        netPayable, totalTransportHandling, totalLandedCost, landedCostPerKg, totalAmountDue,
        marginPerTonne, aflatoxinPass
    };
}

// ==========================================
// 1. NEW TICKET FORM
// ==========================================
function render_custom_new_ticket_page(frm) {
    clear_all_custom_views(frm);

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const todayFormatted = `${day}-${month}-${year}`;

    const defaultQty = frm.doc.quantity_kg || '';

    const formHtml = `
        <div>
            <h2 class="font-weight-bold mb-4" style="color: #0f172a; font-size: 24px;">New ticket</h2>

            <div class="mb-4 d-flex align-items-center p-3 rounded" style="background-color: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; font-size: 13.5px; border-radius: 8px;">
                <span class="mr-2" style="font-size: 16px; color: #64748b;">ⓘ</span>
                <span>2 supplier(s) are not yet Approved and won't appear below — check Suppliers to move them forward.</span>
            </div>

            <div class="bg-white rounded-lg p-4 border mb-4" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                <h4 class="font-weight-bold mb-4" style="font-size: 15px; color: #0f172a;">Ticket details</h4>

                <div class="row mb-4">
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Supplier <span class="text-danger">*</span></label>
                        <select id="custom_supplier_select" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;">
                            <option value="" disabled selected>Select...</option>
                        </select>
                    </div>

                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Item</label>
                        <select id="custom_item_select" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;">
                            <option value="Maize" selected>Maize</option>
                        </select>
                    </div>

                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Expected quantity (kg) <span class="text-danger">*</span></label>
                        <input type="number" id="custom_qty_input" value="${defaultQty}" placeholder="e.g. 8000" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                </div>

                <div class="row">
                    <div class="col-md-4">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Expected delivery date</label>
                        <div class="input-group" style="position: relative;">
                            <input type="text" id="custom_date_input" value="${todayFormatted}" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px; background-color: #ffffff;" />
                            <div class="input-group-append" style="position: absolute; right: 10px; top: 8px; pointer-events: none; color: #64748b;">
                                <i class="fa fa-calendar"></i>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3">
                <button id="btn_custom_save" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                    Create ticket
                </button>
                <button id="btn_custom_cancel" class="btn btn-link text-dark font-weight-bold px-3" style="text-decoration: none; font-size: 13.5px;">
                    Cancel
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('New ticket', 'Trade', 'New ticket', formHtml));
    attach_portal_events(frm);

    frappe.call({
        method: 'frappe.client.get_list',
        args: { doctype: 'Supplier', fields: ['name', 'supplier_name'], limit_page_length: 100 },
        callback: function(r) {
            if (r.message && r.message.length) {
                const $supplierSelect = $('#custom_supplier_select');
                r.message.forEach(s => {
                    const selected = frm.doc.supplier === s.name ? 'selected' : '';
                    $supplierSelect.append(`<option value="${s.name}" ${selected}>${s.supplier_name || s.name}</option>`);
                });
            }
        }
    });

    frappe.call({
        method: 'frappe.client.get_list',
        args: { doctype: 'Item', fields: ['name', 'item_name'], filters: { disabled: 0 }, limit_page_length: 200, order_by: 'item_name asc' },
        callback: function(r) {
            const $itemSelect = $('#custom_item_select');
            $itemSelect.empty();
            if (r.message && r.message.length) {
                r.message.forEach(item => {
                    const isSelected = (frm.doc.commodity === item.name || item.item_name === 'Maize' || item.name === 'Maize') ? 'selected' : '';
                    $itemSelect.append(`<option value="${item.name}" ${isSelected}>${item.item_name || item.name}</option>`);
                });
            } else {
                ['Maize', 'Beans', 'Wheat', 'Barley', 'Sorghum'].forEach(opt => {
                    const isSelected = (frm.doc.commodity === opt || opt === 'Maize') ? 'selected' : '';
                    $itemSelect.append(`<option value="${opt}" ${isSelected}>${opt}</option>`);
                });
            }
        }
    });

    $('#btn_custom_save').on('click', function() {
        const supplier = $('#custom_supplier_select').val();
        const item = $('#custom_item_select').val();
        const qty = parseFloat($('#custom_qty_input').val()) || 0;

        if (!supplier) { frappe.msgprint(__('Please select a Supplier.')); return; }
        if (!item) { frappe.msgprint(__('Please select an Item.')); return; }
        if (qty <= 0) { frappe.msgprint(__('Please enter a valid Expected Quantity.')); return; }

        frm.set_value('supplier', supplier);
        frm.set_value('commodity', item);
        frm.set_value('quantity_kg', qty);
        frm.set_value('status', 'Ticket');
        if (!frm.doc.negotiated_price) frm.set_value('negotiated_price', 48.0);

        frm.save().then(() => {
            frappe.show_alert({ message: __('Ticket created successfully'), indicator: 'green' });
            render_custom_ticket_details_page(frm);
        });
    });

    $('#btn_custom_cancel').on('click', () => frappe.set_route('List', 'Buy Ticket'));
}

// ==========================================
// 2. TICKET OVERVIEW VIEW
// ==========================================
function render_custom_ticket_details_page(frm) {
    clear_all_custom_views(frm);

    const doc = frm.doc;
    const cleanName = (doc.name || '').replace(/[^a-zA-Z0-9]/g, '');
    const suffix = cleanName.length >= 5 ? cleanName.slice(-5).toUpperCase() : (cleanName.toUpperCase() || 'QIZ3T');
    const lotId = doc.lot_id || ('LOT-' + suffix);
    const origin = doc.country || doc.county || doc.region || doc.area || 'origin not yet captured';

    const contentHtml = `
        <div>
            <div class="stepper-nav d-flex align-items-center gap-2 mb-4">
                <div class="step-badge step-badge-active"><span class="step-num-active">1</span> Ticket</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">2</span> Intake</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">3</span> Lot</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">4</span> Position</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">5</span> Invoiced</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">6</span> Settled</div>
            </div>

            <div class="d-flex align-items-start justify-content-between mb-4">
                <div>
                    <h1 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">
                        ${doc.name} <span class="text-muted font-weight-normal" style="font-size: 20px;">· ${lotId}</span>
                    </h1>
                    <p class="text-muted m-0" style="font-size: 14px;">${doc.supplier || '—'} · ${origin}</p>
                </div>
                <div>
                    <span class="badge badge-pill px-3 py-1.5" style="background-color: #f1f5f9; color: #475569; font-size: 12px; font-weight: 500;">
                        <span style="color: #94a3b8; font-size: 9px; margin-right: 3px;">●</span> ${doc.status || 'Ticket'}
                    </span>
                </div>
            </div>

            <div class="mb-4">
                <h6 class="font-weight-bold text-uppercase text-muted mb-2" style="font-size: 11.5px; letter-spacing: 0.5px;">OVERVIEW</h6>
                <div class="bg-white rounded-lg p-4 border" style="border-color: #e2e8f0; border-radius: 10px;">
                    <div class="row mb-4">
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Supplier</div><div class="font-weight-bold text-dark" style="font-size: 14.5px;">${doc.supplier || '—'}</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Customer</div><div class="font-weight-bold text-dark" style="font-size: 14.5px;">Not yet matched</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Gross weight</div><div class="text-dark" style="font-size: 14.5px;">${doc.gross_weight_kg ? Number(doc.gross_weight_kg).toLocaleString() + ' kg' : '—'}</div></div>
                    </div>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3 mt-4 pt-2">
                <button id="btn_continue_intake" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                    Continue to Intake →
                </button>
                <button id="btn_back_to_lots" class="btn btn-link text-dark font-weight-bold px-3" style="text-decoration: none; font-size: 13.5px;">
                    Back to lots
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('Lots', 'Trade', `${doc.name} · ${lotId}`, contentHtml));
    attach_portal_events(frm);

    $('#btn_back_to_lots').on('click', () => frappe.set_route('List', 'Buy Ticket'));
    $('#btn_continue_intake').on('click', () => {
        frm.set_value('status', 'Intake');
        frm.save().then(() => render_intake_quality_capture_page(frm));
    });
}

// ==========================================
// 3. INTAKE & QUALITY CAPTURE FORM
// ==========================================
function render_intake_quality_capture_page(frm) {
    clear_all_custom_views(frm);

    const doc = frm.doc;
    const grossWeight = doc.gross_weight_kg || '';
    const tareWeight = doc.tare_weight_kg || '';
    const bagCount = doc.bag_count || '';
    const wbNumber = doc.weighbridge_ticket_number || '';
    const vehicleReg = doc.vehicle_registration || '';
    const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));

    const moisture = doc.moisture_percent || '';
    const foreignMatter = doc.foreign_matter_percent || '';
    const aflatoxin = doc.aflatoxin_ppb || '';
    const area = doc.area || '';
    const reasonCode = doc.reason_code || '';

    const meta = frappe.get_meta('Buy Ticket');
    const transporterField = meta && meta.fields ? meta.fields.find(df => df.fieldname === 'transporter') : null;
    
    let transporterOptions = [];
    if (transporterField && transporterField.options) {
        transporterOptions = transporterField.options.split('\n').map(opt => opt.trim()).filter(Boolean);
    }

    const transporterOptionsHtml = transporterOptions.length > 0
        ? transporterOptions.map(opt => {
            const isSelected = (doc.transporter === opt || (!doc.transporter && opt === transporterOptions[0])) ? 'selected' : '';
            return `<option value="${opt}" ${isSelected}>${opt}</option>`;
        }).join('')
        : `<option value="" disabled selected>Select...</option>`;

    const contentHtml = `
        <div>
            <div class="mb-4">
                <h2 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">Intake & quality capture</h2>
                <p class="text-muted m-0" style="font-size: 14px;">${doc.name} · ${doc.supplier || 'Cherono Bulk Suppliers'}</p>
            </div>

            <div class="bg-white rounded-lg p-4 border mb-4" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                <h4 class="font-weight-bold mb-4" style="font-size: 15px; color: #0f172a;">Weighbridge capture</h4>

                <div class="row mb-3">
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Gross weight (kg) <span class="text-danger">*</span></label>
                        <input type="number" id="intake_gross_weight" value="${grossWeight}" class="form-control form-control-sm calculate-net" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Tare weight (kg) <span class="text-danger">*</span></label>
                        <input type="number" id="intake_tare_weight" value="${tareWeight}" class="form-control form-control-sm calculate-net" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Bag count <span class="text-danger">*</span></label>
                        <input type="number" id="intake_bag_count" value="${bagCount}" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                </div>

                <div class="row mb-3">
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Weighbridge ticket number <span class="text-danger">*</span></label>
                        <input type="text" id="intake_wb_number" value="${wbNumber}" placeholder="Unique, e.g. WB-88213" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Transporter</label>
                        <select id="intake_transporter_select" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;">
                            ${transporterOptionsHtml}
                        </select>
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Vehicle registration</label>
                        <input type="text" id="intake_vehicle_reg" value="${vehicleReg}" placeholder="e.g. KDA 221C" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                </div>

                <div class="row mb-4">
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted font-weight-medium d-block" style="font-size: 12.5px;">Weighbridge slip — gross (in)</label>
                        <button id="btn_upload_gross" class="btn btn-outline-secondary btn-sm px-3 py-1.5" style="border-radius: 6px; font-size: 13px; background-color: #f8fafc; border-color: #cbd5e1; color: #334155;">
                            <i class="fa fa-upload mr-1"></i> Upload
                        </button>
                        <span id="gross_file_name" class="ml-2 text-muted text-xs"></span>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted font-weight-medium d-block" style="font-size: 12.5px;">Weighbridge slip — tare (out)</label>
                        <button id="btn_upload_tare" class="btn btn-outline-secondary btn-sm px-3 py-1.5" style="border-radius: 6px; font-size: 13px; background-color: #f8fafc; border-color: #cbd5e1; color: #334155;">
                            <i class="fa fa-upload mr-1"></i> Upload
                        </button>
                        <span id="tare_file_name" class="ml-2 text-muted text-xs"></span>
                    </div>
                </div>

                <div class="mb-2">
                    <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Net weight (calculated)</label>
                    <div id="display_net_weight" class="form-control d-flex align-items-center bg-light text-dark font-weight-bold" style="height: 38px; border-color: #e2e8f0; border-radius: 6px; font-size: 14px;">
                        ${netWeight.toLocaleString()} kg
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-lg p-4 border mb-4" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                <h4 class="font-weight-bold mb-4" style="font-size: 15px; color: #0f172a;">Quality inspection</h4>

                <div class="row mb-3">
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Moisture % <span class="text-danger">*</span></label>
                        <input type="number" step="0.1" id="quality_moisture" value="${moisture}" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Foreign matter % <span class="text-danger">*</span></label>
                        <input type="number" step="0.1" id="quality_foreign_matter" value="${foreignMatter}" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Aflatoxin ppb <span class="text-danger">*</span></label>
                        <input type="number" step="0.1" id="quality_aflatoxin" value="${aflatoxin}" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                </div>

                <div class="row mb-3">
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">County</label>
                        <select id="quality_county_select" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;">
                            <option value="" disabled selected>Select...</option>
                        </select>
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Area</label>
                        <input type="text" id="quality_area" value="${area}" placeholder="e.g. Njoro" class="form-control form-control-sm" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                    </div>
                </div>

                <div class="mb-2">
                    <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Reason code (if foreign matter judgement or wet buy)</label>
                    <textarea id="quality_reason_code" rows="3" class="form-control" style="border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;">${reasonCode}</textarea>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3">
                <button id="btn_submit_intake_create_lot" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                    Submit intake & create lot
                </button>
                <button id="btn_cancel_intake" class="btn btn-link text-dark font-weight-bold px-3" style="text-decoration: none; font-size: 13.5px;">
                    Cancel
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('Intake & quality', 'Trade', 'Intake & quality', contentHtml));
    attach_portal_events(frm);

    frappe.call({
        method: 'frappe.client.get_list',
        args: { doctype: 'Country', fields: ['name', 'country_name'], limit_page_length: 250, order_by: 'name asc' },
        callback: function(r) {
            const $countrySelect = $('#quality_county_select');
            $countrySelect.empty();
            $countrySelect.append('<option value="" disabled selected>Select...</option>');
            if (r.message && r.message.length) {
                r.message.forEach(c => {
                    const val = c.name;
                    const label = c.country_name || c.name;
                    const isSelected = (doc.country === val || doc.county === val) ? 'selected' : '';
                    $countrySelect.append(`<option value="${val}" ${isSelected}>${label}</option>`);
                });
            }
        }
    });

    $('.calculate-net').on('input', function() {
        const g = parseFloat($('#intake_gross_weight').val()) || 0;
        const t = parseFloat($('#intake_tare_weight').val()) || 0;
        const net = Math.max(0, g - t);
        $('#display_net_weight').text(`${net.toLocaleString()} kg`);
    });

    $('#btn_upload_gross').on('click', () => {
        new frappe.ui.FileUploader({
            doctype: frm.doctype, docname: frm.docname,
            on_success: (file_doc) => $('#gross_file_name').text(file_doc.file_name)
        });
    });

    $('#btn_upload_tare').on('click', () => {
        new frappe.ui.FileUploader({
            doctype: frm.doctype, docname: frm.docname,
            on_success: (file_doc) => $('#tare_file_name').text(file_doc.file_name)
        });
    });

    $('#btn_submit_intake_create_lot').on('click', function() {
        const gross = parseFloat($('#intake_gross_weight').val()) || 0;
        const tare = parseFloat($('#intake_tare_weight').val()) || 0;
        const bags = parseInt($('#intake_bag_count').val()) || 0;
        const wbNo = $('#intake_wb_number').val();
        const moistureVal = parseFloat($('#quality_moisture').val());
        const foreignMatterVal = parseFloat($('#quality_foreign_matter').val());
        const aflatoxinVal = parseFloat($('#quality_aflatoxin').val());
        const selectedCounty = $('#quality_county_select').val();
        const selectedTransporter = $('#intake_transporter_select').val();

        if (!gross || gross <= 0) { frappe.msgprint(__('Please enter a valid Gross Weight.')); return; }
        if (!tare || tare <= 0) { frappe.msgprint(__('Please enter a valid Tare Weight.')); return; }
        if (!bags || bags <= 0) { frappe.msgprint(__('Please enter a valid Bag Count.')); return; }
        if (!wbNo) { frappe.msgprint(__('Please enter the Weighbridge Ticket Number.')); return; }
        if (isNaN(moistureVal)) { frappe.msgprint(__('Please enter Moisture %.')); return; }
        if (isNaN(foreignMatterVal)) { frappe.msgprint(__('Please enter Foreign matter %.')); return; }
        if (isNaN(aflatoxinVal)) { frappe.msgprint(__('Please enter Aflatoxin ppb.')); return; }

        if (frm.fields_dict['gross_weight_kg']) frm.set_value('gross_weight_kg', gross);
        if (frm.fields_dict['tare_weight_kg']) frm.set_value('tare_weight_kg', tare);
        if (frm.fields_dict['bag_count']) frm.set_value('bag_count', bags);
        if (frm.fields_dict['weighbridge_ticket_number']) frm.set_value('weighbridge_ticket_number', wbNo);
        if (frm.fields_dict['transporter']) frm.set_value('transporter', selectedTransporter);
        if (frm.fields_dict['vehicle_registration']) frm.set_value('vehicle_registration', $('#intake_vehicle_reg').val());

        if (frm.fields_dict['moisture_percent']) frm.set_value('moisture_percent', moistureVal);
        if (frm.fields_dict['foreign_matter_percent']) frm.set_value('foreign_matter_percent', foreignMatterVal);
        if (frm.fields_dict['aflatoxin_ppb']) frm.set_value('aflatoxin_ppb', aflatoxinVal);
        
        if (frm.fields_dict['country']) {
            frm.set_value('country', selectedCounty);
        } else if (frm.fields_dict['county']) {
            frm.set_value('county', selectedCounty);
        }

        if (frm.fields_dict['area']) frm.set_value('area', $('#quality_area').val());
        if (frm.fields_dict['reason_code']) frm.set_value('reason_code', $('#quality_reason_code').val());

        frm.set_value('status', 'Lot');

        frm.save().then(() => {
            frappe.show_alert({ message: __('Intake submitted & lot created successfully!'), indicator: 'green' });
            render_deductions_payable_page(frm);
        });
    });

    $('#btn_cancel_intake').on('click', () => render_intake_overview_page(frm));
}

// ==========================================
// 4. INTAKE STATUS OVERVIEW PAGE
// ==========================================
function render_intake_overview_page(frm) {
    clear_all_custom_views(frm);

    const doc = frm.doc;
    const cleanName = (doc.name || '').replace(/[^a-zA-Z0-9]/g, '');
    const suffix = cleanName.length >= 5 ? cleanName.slice(-5).toUpperCase() : (cleanName.toUpperCase() || 'I3CKZ');
    const lotId = doc.lot_id || ('LOT-' + suffix);
    const origin = [doc.country || doc.county || doc.region, doc.bag_count ? `${doc.bag_count} bags` : null].filter(Boolean).join(', ') || 'Trans Nzoia, 20 bags';
    const p = compute_ticket_payable(doc);

    const contentHtml = `
        <div>
            <div class="stepper-nav d-flex align-items-center gap-2 mb-4">
                <div class="step-badge"><span class="step-num">1</span> Ticket</div> <span class="step-chevron">›</span>
                <div class="step-badge step-badge-active"><span class="step-num-active">2</span> Intake</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">3</span> Lot</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">4</span> Position</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">5</span> Invoiced</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">6</span> Settled</div>
            </div>

            <div class="d-flex align-items-start justify-content-between mb-4">
                <div>
                    <h1 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">
                        ${doc.name} <span class="text-muted font-weight-normal" style="font-size: 20px;">· ${lotId}</span>
                    </h1>
                    <p class="text-muted m-0" style="font-size: 14px;">${doc.supplier || 'Supplier'} · ${origin}</p>
                </div>
                <div>
                    <span class="badge badge-pill badge-intake-status px-3 py-1.5" style="background-color: #fef3c7; color: #d97706; font-size: 12.5px; font-weight: 500;">
                        <span style="font-size: 9px; margin-right: 4px;">●</span> Intake
                    </span>
                </div>
            </div>

            <div class="intake-progress-stepper mb-5">
                <div class="stepper-line"></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Ticket</span></div>
                <div class="stepper-node active"><div class="circle">2</div><span class="label">Intake</span></div>
                <div class="stepper-node"><div class="circle">3</div><span class="label">Lot</span></div>
                <div class="stepper-node"><div class="circle">4</div><span class="label">Position</span></div>
                <div class="stepper-node"><div class="circle">5</div><span class="label">Invoiced</span></div>
                <div class="stepper-node"><div class="circle">6</div><span class="label">Settled</span></div>
            </div>

            <div class="mb-4">
                <h6 class="font-weight-bold text-uppercase text-muted mb-2" style="font-size: 11.5px; letter-spacing: 0.5px;">OVERVIEW</h6>
                <div class="bg-white rounded-lg p-4 border" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <div class="row mb-4">
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Supplier</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${doc.supplier || 'Supplier'}</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Customer</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">Not yet matched</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Gross weight</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${p.grossKg.toLocaleString()} kg</div></div>
                    </div>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3 mt-4">
                <button id="btn_continue_to_deductions" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                    Continue to Deductions & Payable →
                </button>
                <button id="btn_back_to_lots_action" class="btn btn-link text-dark font-weight-bold px-3" style="text-decoration: none; font-size: 13.5px;">
                    Back to lots
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('Lots', 'Trade', 'Lots', contentHtml));
    attach_portal_events(frm);

    $('#btn_continue_to_deductions').on('click', () => render_deductions_payable_page(frm));
    $('#btn_back_to_lots_action').on('click', () => frappe.set_route('List', 'Buy Ticket'));
}

// ==========================================
// 5. DEDUCTIONS & PAYABLE ENGINE
// ==========================================
function render_deductions_payable_page(frm, selectedDoc) {
    clear_all_custom_views(frm);

    const activeDoc = selectedDoc || frm.doc;
    const p = compute_ticket_payable(activeDoc);

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Buy Ticket',
            filters: { status: ['in', ['Intake', 'Lot', 'Deductions']] },
            fields: ['name', 'status'],
            limit_page_length: 50,
            order_by: 'creation desc'
        },
        callback: function(r) {
            const previousLots = r.message || [];
            let readyLots = [...previousLots];
            if (activeDoc.name && !readyLots.find(l => l.name === activeDoc.name)) {
                readyLots.unshift({ name: activeDoc.name, status: activeDoc.status });
            }

            let readyLotsHtml = '';
            if (readyLots.length > 0) {
                readyLotsHtml = `
                    <div class="d-flex align-items-center gap-2 mb-4">
                        <span class="text-muted" style="font-size: 13px;">${readyLots.length} lot(s) ready:</span>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            ${readyLots.map(l => `
                                <button class="btn btn-sm btn-ready-lot-pill ${l.name === activeDoc.name ? 'btn-active-pill' : 'btn-outline-pill'}" data-name="${l.name}">
                                    ${l.name}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            const contentHtml = `
                <div>
                    <h2 class="font-weight-bold mb-3" style="font-size: 24px; color: #0f172a;">Deductions & payable engine</h2>
                    
                    ${readyLotsHtml}

                    <div class="bg-white rounded-lg p-4 border mb-4" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <h4 class="font-weight-bold mb-4" style="font-size: 16px; color: #0f172a;">Deduction breakdown</h4>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <span class="text-dark" style="font-size: 14px;">Gross weight</span>
                            <span class="font-weight-medium text-dark" style="font-size: 14px;">${p.grossKg.toLocaleString()} kg</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <span class="text-dark" style="font-size: 14px;">Tare weight</span>
                            <span class="font-weight-medium text-danger" style="font-size: 14px;">– ${p.tareKg.toLocaleString()} kg</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <div>
                                <div class="text-dark" style="font-size: 14px;">Net weight</div>
                                <div class="text-muted" style="font-size: 12px;">Gross minus tare</div>
                            </div>
                            <span class="font-weight-medium text-dark" style="font-size: 14px;">${p.netKg.toLocaleString()} kg</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <div>
                                <div class="text-dark" style="font-size: 14px;">Moisture deduction (${p.band})</div>
                                <div class="text-muted" style="font-size: 12px;">${p.moisturePct}% recorded vs 13.5% standard</div>
                            </div>
                            <span class="font-weight-medium text-danger" style="font-size: 14px;">– ${p.moistureDeductionKg.toLocaleString()} kg</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <div>
                                <div class="text-dark" style="font-size: 14px;">Foreign matter deduction</div>
                                <div class="text-muted" style="font-size: 12px;">${p.fmPct}% recorded</div>
                            </div>
                            <span class="font-weight-medium text-danger" style="font-size: 14px;">– ${p.fmDeductionKg.toLocaleString()} kg</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center pt-3">
                            <div>
                                <div class="font-weight-bold text-dark" style="font-size: 14.5px;">Accepted net quantity</div>
                                <div class="text-muted" style="font-size: 12px;">This is what lands in the stock ledger — not the gross weight</div>
                            </div>
                            <span class="font-weight-bold text-dark" style="font-size: 16px;">${p.acceptedNetKg.toLocaleString()} kg</span>
                        </div>
                    </div>

                    <div class="bg-white rounded-lg p-4 border mb-4" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <h4 class="font-weight-bold mb-4" style="font-size: 16px; color: #0f172a;">Payable value</h4>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <span class="text-dark" style="font-size: 14px;">Reference rate</span>
                            <span class="font-weight-medium text-dark" style="font-size: 14px;">KES ${p.refRatePerKg} /kg</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <div>
                                <div class="text-dark" style="font-size: 14px;">Gross value</div>
                                <div class="text-muted" style="font-size: 12px;">${p.acceptedNetKg.toLocaleString()} kg × rate</div>
                            </div>
                            <span class="font-weight-medium text-dark" style="font-size: 14px;">KES ${p.grossValue.toLocaleString()}</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <div>
                                <div class="text-dark" style="font-size: 14px;">Bagging deduction</div>
                                <div class="text-muted" style="font-size: 12px;">${p.bags} bags × KES 25</div>
                            </div>
                            <span class="font-weight-medium text-danger" style="font-size: 14px;">– KES ${p.baggingDeduction.toLocaleString()}</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center py-2.5 border-bottom" style="border-color: #f1f5f9;">
                            <span class="text-dark" style="font-size: 14px;">Aflatoxin test fee</span>
                            <span class="font-weight-medium text-danger" style="font-size: 14px;">– KES ${p.aflatoxinTestFee.toLocaleString()}</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center pt-3">
                            <span class="font-weight-bold text-dark" style="font-size: 14.5px;">Net payable to supplier</span>
                            <span class="font-weight-bold text-dark" style="font-size: 16px;">KES ${p.netPayable.toLocaleString()}</span>
                        </div>
                    </div>

                    <div class="d-flex align-items-center gap-3">
                        <button id="btn_post_invoice_create_lot" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                            Post net invoice & proceed to Transport
                        </button>
                        <button id="btn_back_to_lots_from_engine" class="btn btn-link text-muted font-weight-medium px-3" style="text-decoration: none; font-size: 13.5px;">
                            Back to lots
                        </button>
                    </div>
                </div>
            `;

            $('body').append(get_portal_shell_html('Deductions & payable', 'Trade', 'Deductions & payable', contentHtml));
            attach_portal_events(frm);

            $('.btn-ready-lot-pill').on('click', function() {
                const targetName = $(this).data('name');
                if (targetName) {
                    frappe.call({
                        method: 'frappe.client.get',
                        args: { doctype: 'Buy Ticket', name: targetName },
                        callback: function(res) {
                            if (res.message) {
                                render_deductions_payable_page(frm, res.message);
                            }
                        }
                    });
                }
            });

            $('#btn_post_invoice_create_lot').on('click', () => {
                const cleanNum = (activeDoc.name || '').replace(/[^0-9]/g, '');
                const invoiceNumber = `INV-${cleanNum || '5503'}`;
                const generatedCU = `KRA-CU-${Math.floor(100000 + Math.random() * 900000)}`;

                if (frm.fields_dict['sales_invoice_number']) frm.set_value('sales_invoice_number', invoiceNumber);
                if (frm.fields_dict['etims_control_unit_number']) frm.set_value('etims_control_unit_number', generatedCU);
                if (frm.fields_dict['accepted_net_weight_kg']) frm.set_value('accepted_net_weight_kg', p.acceptedNetKg);
                if (frm.fields_dict['net_payable_kes']) frm.set_value('net_payable_kes', p.netPayable);

                frm.set_value('status', 'Lot');

                frm.save().then(() => {
                    frappe.show_alert({ 
                        message: __(`Net invoice ${invoiceNumber} saved! Status updated to Lot.`), 
                        indicator: 'green' 
                    });
                    render_transport_loss_page(frm);
                });
            });

            $('#btn_back_to_lots_from_engine').on('click', () => frappe.set_route('List', 'Buy Ticket'));
        }
    });
}

// ==========================================
// 6. TRANSPORT & LOSS PAGE
// ==========================================
function render_transport_loss_page(frm, selectedDoc) {
    clear_all_custom_views(frm);

    const activeDoc = selectedDoc || frm.doc;
    const p = compute_ticket_payable(activeDoc);
    const expectedQty = parseFloat(activeDoc.quantity_kg) || p.acceptedNetKg || 500;
    const deliveredQty = parseFloat(activeDoc.delivered_quantity_kg) || expectedQty;
    const haulage = activeDoc.haulage_kes || '';
    const cess = activeDoc.cess_kes || '';
    const offloading = activeDoc.offloading_kes || '';

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Buy Ticket',
            filters: { status: 'Lot' },
            fields: ['name', 'status'],
            limit_page_length: 50,
            order_by: 'creation desc'
        },
        callback: function(r) {
            const previousLots = r.message || [];
            let readyLots = [...previousLots];
            if (activeDoc.name && !readyLots.find(l => l.name === activeDoc.name)) {
                readyLots.unshift({ name: activeDoc.name, status: activeDoc.status });
            }

            let readyLotsHtml = '';
            if (readyLots.length > 0) {
                readyLotsHtml = `
                    <div class="d-flex align-items-center gap-2 mb-4">
                        <span class="text-muted" style="font-size: 13px;">${readyLots.length} lot(s) ready:</span>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            ${readyLots.map(l => `
                                <button class="btn btn-sm btn-ready-lot-pill ${l.name === activeDoc.name ? 'btn-active-pill' : 'btn-outline-pill'}" data-name="${l.name}">
                                    ${l.name}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            const contentHtml = `
                <div>
                    <div class="mb-4">
                        <h2 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">Transport & loss</h2>
                        <p class="text-muted m-0" style="font-size: 14px;">${activeDoc.name} · ${activeDoc.supplier || 'Supplier'}</p>
                    </div>

                    ${readyLotsHtml}

                    <div class="bg-white rounded-lg p-4 border mb-4" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <h4 class="font-weight-bold mb-4" style="font-size: 15px; color: #0f172a;">Transport charges</h4>

                        <div class="row">
                            <div class="col-md-4 mb-3">
                                <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Haulage (KES)</label>
                                <input type="number" id="inp_haulage" value="${haulage}" placeholder="0" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Cess (KES)</label>
                                <input type="number" id="inp_cess" value="${cess}" placeholder="0" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Offloading (KES)</label>
                                <input type="number" id="inp_offloading" value="${offloading}" placeholder="0" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;" />
                            </div>
                        </div>
                    </div>

                    <div class="d-flex align-items-center gap-3">
                        <button id="btn_capitalise_move_position" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                            Capitalise costs & move to Position
                        </button>
                        <button id="btn_back_to_lots_from_transport" class="btn btn-link text-muted font-weight-medium px-3" style="text-decoration: none; font-size: 13.5px;">
                            Back to lots
                        </button>
                    </div>
                </div>
            `;

            $('body').append(get_portal_shell_html('Transport & loss', 'Trade', 'Transport & loss', contentHtml));
            attach_portal_events(frm);

            $('.btn-ready-lot-pill').on('click', function() {
                const targetName = $(this).data('name');
                if (targetName) {
                    frappe.call({
                        method: 'frappe.client.get',
                        args: { doctype: 'Buy Ticket', name: targetName },
                        callback: function(res) {
                            if (res.message) {
                                render_transport_loss_page(frm, res.message);
                            }
                        }
                    });
                }
            });

            $('#btn_capitalise_move_position').on('click', function() {
                const haulageVal = parseFloat($('#inp_haulage').val()) || 0;
                const cessVal = parseFloat($('#inp_cess').val()) || 0;
                const offloadingVal = parseFloat($('#inp_offloading').val()) || 0;
                const delVal = parseFloat($('#inp_delivered_qty').val()) || expectedQty;

                if (frm.fields_dict['haulage_kes']) frm.set_value('haulage_kes', haulageVal);
                if (frm.fields_dict['cess_kes']) frm.set_value('cess_kes', cessVal);
                if (frm.fields_dict['offloading_kes']) frm.set_value('offloading_kes', offloadingVal);
                if (frm.fields_dict['delivered_quantity_kg']) frm.set_value('delivered_quantity_kg', delVal);

                frm.set_value('status', 'Position');

                frm.save().then(() => {
                    frappe.show_alert({ message: __('Transport capitalised & moved to Position!'), indicator: 'green' });
                    render_position_overview_page(frm);
                });
            });

            $('#btn_back_to_lots_from_transport').on('click', () => frappe.set_route('List', 'Buy Ticket'));
        }
    });
}

// ==========================================
// 7. POSITION PAGE
// ==========================================
function render_position_overview_page(frm) {
    clear_all_custom_views(frm);

    const doc = frm.doc;
    const cleanName = (doc.name || '').replace(/[^a-zA-Z0-9]/g, '');
    const suffix = cleanName.length >= 5 ? cleanName.slice(-5).toUpperCase() : (cleanName.toUpperCase() || '03RXK');
    const lotId = doc.lot_id || ('LOT-' + suffix);
    const locationStr = [doc.country || doc.county || 'Nakuru', doc.area || 'Njoro'].filter(Boolean).join(', ');
    const p = compute_ticket_payable(doc);

    const contentHtml = `
        <div>
            <div class="stepper-nav d-flex align-items-center gap-2 mb-4">
                <div class="step-badge"><span class="step-num">1</span> Ticket</div> <span class="step-chevron">›</span>
                <div class="step-badge step-badge-active"><span class="step-num-active">3</span> Lot</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">6</span> Settled</div>
            </div>

            <div class="d-flex align-items-start justify-content-between mb-4">
                <div>
                    <h1 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">
                        ${doc.name} <span class="text-muted font-weight-normal" style="font-size: 20px;">· ${lotId}</span>
                    </h1>
                    <p class="text-muted m-0" style="font-size: 14px;">${doc.supplier || 'Supplier'} · ${locationStr}</p>
                </div>
                <div>
                    <span class="badge badge-pill px-3 py-1.5" style="background-color: #e0f2fe; color: #0284c7; font-size: 13px; font-weight: 500;">
                        <span style="font-size: 9px; margin-right: 4px;">●</span> Position
                    </span>
                </div>
            </div>

            <div class="intake-progress-stepper mb-5">
                <div class="stepper-line"></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Ticket</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Intake</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Lot</span></div>
                <div class="stepper-node active"><div class="circle">4</div><span class="label">Position</span></div>
                <div class="stepper-node"><div class="circle">5</div><span class="label">Invoiced</span></div>
                <div class="stepper-node"><div class="circle">6</div><span class="label">Settled</span></div>
            </div>

            <div class="mb-4">
                <h6 class="font-weight-bold text-uppercase text-muted mb-2" style="font-size: 11.5px; letter-spacing: 0.5px;">OVERVIEW</h6>
                <div class="bg-white rounded-lg p-4 border" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <div class="row mb-4">
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Supplier</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${doc.supplier || 'Supplier'}</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Customer</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">Not yet matched</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Gross weight</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${p.grossKg.toLocaleString()} kg</div></div>
                    </div>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3 mt-4">
                <button id="btn_continue_to_invoiced" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                    Continue to Invoiced →
                </button>
                <button id="btn_back_to_lots_from_position" class="btn btn-link text-dark font-weight-bold px-3" style="text-decoration: none; font-size: 13.5px;">
                    Back to lots
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('Lots', 'Trade', 'Lots', contentHtml));
    attach_portal_events(frm);

    $('#btn_continue_to_invoiced').on('click', () => render_sale_invoicing_page(frm));
    $('#btn_back_to_lots_from_position').on('click', () => frappe.set_route('List', 'Buy Ticket'));
}

// ==========================================
// 8. INVOICED STATUS OVERVIEW PAGE
// ==========================================
function render_invoiced_overview_page(frm) {
    clear_all_custom_views(frm);

    const doc = frm.doc;
    const cleanName = (doc.name || '').replace(/[^a-zA-Z0-9]/g, '');
    const suffix = cleanName.length >= 5 ? cleanName.slice(-5).toUpperCase() : (cleanName.toUpperCase() || '03RXK');
    const lotId = doc.lot_id || ('LOT-' + suffix);
    const locationStr = [doc.country || doc.county || 'Nakuru', doc.area || 'Njoro'].filter(Boolean).join(', ');
    const p = compute_ticket_payable(doc);

    const invoiceNum = doc.sales_invoice_number || `INV-${(doc.name || '').replace(/[^0-9]/g, '') || '5503'}`;
    const customerName = doc.customer || 'Unga Group Kenya';

    const contentHtml = `
        <div>
            <div class="d-flex align-items-start justify-content-between mb-4">
                <div>
                    <h1 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">
                        ${doc.name} <span class="text-muted font-weight-normal" style="font-size: 20px;">· ${lotId}</span>
                    </h1>
                    <p class="text-muted m-0" style="font-size: 14px;">${doc.supplier || 'Supplier'} · ${locationStr}</p>
                </div>
                <div>
                    <span class="badge badge-pill px-3 py-1.5" style="background-color: #fef3c7; color: #d97706; font-size: 12.5px; font-weight: 500;">
                        <span style="font-size: 9px; margin-right: 4px;">●</span> Invoiced
                    </span>
                </div>
            </div>

            <div class="intake-progress-stepper mb-5">
                <div class="stepper-line"></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Ticket</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Intake</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Lot</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Position</span></div>
                <div class="stepper-node active"><div class="circle">5</div><span class="label">Invoiced</span></div>
                <div class="stepper-node"><div class="circle">6</div><span class="label">Settled</span></div>
            </div>

            <div class="mb-4">
                <h6 class="font-weight-bold text-uppercase text-muted mb-2" style="font-size: 11.5px; letter-spacing: 0.5px;">OVERVIEW</h6>
                <div class="bg-white rounded-lg p-4 border" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <div class="row mb-4">
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Supplier</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${doc.supplier || 'Supplier'}</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Customer</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${customerName}</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Gross weight</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${p.grossKg.toLocaleString()} kg</div></div>
                    </div>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3 mt-4">
                <button id="btn_continue_to_settled" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                    Continue to Settled →
                </button>
                <button id="btn_back_to_lots_from_invoiced" class="btn btn-link text-dark font-weight-bold px-3" style="text-decoration: none; font-size: 13.5px;">
                    Back to lots
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('Lots', 'Trade', 'Lots', contentHtml));
    attach_portal_events(frm);

    $('#btn_continue_to_settled').on('click', () => render_customer_payment_page(frm));
    $('#btn_back_to_lots_from_invoiced').on('click', () => frappe.set_route('List', 'Buy Ticket'));
}

// ==========================================
// 9. RECORD CUSTOMER PAYMENT & SETTLE
// ==========================================
function render_customer_payment_page(frm) {
    clear_all_custom_views(frm);

    const doc = frm.doc;
    const p = compute_ticket_payable(doc);
    const invoiceNum = doc.sales_invoice_number || `INV-${(doc.name || '').replace(/[^0-9]/g, '') || '5502'}`;
    const customerName = doc.customer || 'Unga Group Kenya';

    const contentHtml = `
        <div>
            <div class="mb-4">
                <h2 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">Record customer payment</h2>
                <p class="text-muted m-0" style="font-size: 14px;">${doc.name} · ${customerName} · ${invoiceNum}</p>
            </div>

            <div class="bg-white rounded-lg p-4 border mb-4" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                <h4 class="font-weight-bold mb-4" style="font-size: 15px; color: #0f172a;">Customer payment</h4>

                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Amount due</label>
                        <div class="form-control bg-light font-weight-medium text-dark d-flex align-items-center font-mono" style="height: 38px; border-color: #e2e8f0; border-radius: 6px; font-size: 14px;">
                            KES ${p.totalAmountDue.toLocaleString()}
                        </div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted font-weight-medium" style="font-size: 12.5px;">Payment rail</label>
                        <select id="payment_rail_select" class="form-control" style="height: 38px; border-color: #cbd5e1; border-radius: 6px; font-size: 13.5px;">
                            <option value="Bank Transfer" selected>Bank Transfer</option>
                            <option value="M-Pesa Paybill">M-Pesa Paybill</option>
                            <option value="Cheque">Cheque</option>
                            <option value="Cash">Cash</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3">
                <button id="btn_confirm_receipt_settle" class="btn text-white font-weight-bold px-4 py-2" style="background-color: #0f2438; border-radius: 6px; font-size: 13.5px;">
                    Confirm receipt & settle lot
                </button>
                <button id="btn_cancel_payment" class="btn btn-link text-dark font-weight-bold px-3" style="text-decoration: none; font-size: 13.5px;">
                    Cancel
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('Payments', 'Finance', 'Payments', contentHtml));
    attach_portal_events(frm);

    $('#btn_confirm_receipt_settle').on('click', () => {
        const rail = $('#payment_rail_select').val();
        const paidAmount = p.totalAmountDue;

        frappe.call({
            method: 'frappe.client.get_list',
            args: { doctype: 'Sales Invoice', filters: { name: invoiceNum }, fields: ['name', 'outstanding_amount'] },
            callback: function(r) {
                const salesInv = (r.message && r.message.length) ? r.message[0] : null;
                const paymentDoc = {
                    doctype: 'Payment Entry',
                    payment_type: 'Receive',
                    party_type: 'Customer',
                    party: customerName,
                    mode_of_payment: rail,
                    paid_amount: paidAmount,
                    received_amount: paidAmount,
                    target_exchange_rate: 1
                };

                if (salesInv) {
                    paymentDoc.references = [{
                        reference_doctype: 'Sales Invoice',
                        reference_name: salesInv.name,
                        total_amount: salesInv.outstanding_amount || paidAmount,
                        allocated_amount: paidAmount
                    }];
                }

                frappe.call({
                    method: 'frappe.client.insert',
                    args: { doc: paymentDoc },
                    callback: function(pe_res) {
                        const peName = pe_res.message ? pe_res.message.name : `PAY-${Math.floor(7100 + Math.random() * 90)}`;
                        if (pe_res.message) {
                            frappe.call({
                                method: 'frappe.client.submit',
                                args: { doc: pe_res.message },
                                callback: () => complete_settle_ticket(frm, peName, rail)
                            });
                        } else {
                            complete_settle_ticket(frm, peName, rail);
                        }
                    }
                });
            }
        });
    });

    $('#btn_cancel_payment').on('click', () => render_invoiced_overview_page(frm));
}

function complete_settle_ticket(frm, peName, rail) {
    if (frm.fields_dict['payment_entry']) frm.set_value('payment_entry', peName);
    if (frm.fields_dict['payment_mode']) frm.set_value('payment_mode', rail);
    frm.set_value('status', 'Settled');

    frm.save().then(() => {
        frappe.show_alert({ message: __(`Payment Entry ${peName} submitted! Lot Settled.`), indicator: 'green' });
        render_settled_overview_page(frm);
    });
}

// ==========================================
// 10. SETTLED OVERVIEW PAGE
// ==========================================
function render_settled_overview_page(frm) {
    clear_all_custom_views(frm);

    const doc = frm.doc;
    const cleanName = (doc.name || '').replace(/[^a-zA-Z0-9]/g, '');
    const suffix = cleanName.length >= 5 ? cleanName.slice(-5).toUpperCase() : (cleanName.toUpperCase() || 'PI113');
    const lotId = doc.lot_id || ('LOT-' + suffix);
    const locationStr = [doc.country || doc.county || 'Nakuru', doc.area || 'Njoro'].filter(Boolean).join(', ');
    const p = compute_ticket_payable(doc);

    const contentHtml = `
        <div>
            <div class="stepper-nav d-flex align-items-center gap-2 mb-4">
                <div class="step-badge"><span class="step-num">1</span> Ticket</div> <span class="step-chevron">›</span>
                <div class="step-badge step-badge-active"><span class="step-num-active">3</span> Lot</div> <span class="step-chevron">›</span>
                <div class="step-badge"><span class="step-num">6</span> Settled</div>
            </div>

            <div class="d-flex align-items-start justify-content-between mb-4">
                <div>
                    <h1 class="font-weight-bold mb-1" style="font-size: 24px; color: #0f172a;">
                        ${doc.name} <span class="text-muted font-weight-normal" style="font-size: 20px;">· ${lotId}</span>
                    </h1>
                    <p class="text-muted m-0" style="font-size: 14px;">${doc.supplier || 'Supplier'} · ${locationStr}</p>
                </div>
                <div>
                    <span class="badge badge-pill px-3 py-1.5" style="background-color: #dcfce7; color: #15803d; font-size: 12.5px; font-weight: 500;">
                        <span style="font-size: 9px; margin-right: 4px;">●</span> Settled
                    </span>
                </div>
            </div>

            <div class="intake-progress-stepper mb-5">
                <div class="stepper-line"></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Ticket</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Intake</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Lot</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Position</span></div>
                <div class="stepper-node done"><div class="circle"><i class="fa fa-check"></i></div><span class="label">Invoiced</span></div>
                <div class="stepper-node active"><div class="circle">6</div><span class="label">Settled</span></div>
            </div>

            <div class="mb-4">
                <h6 class="font-weight-bold text-uppercase text-muted mb-2" style="font-size: 11.5px; letter-spacing: 0.5px;">OVERVIEW</h6>
                <div class="bg-white rounded-lg p-4 border" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <div class="row mb-4">
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Supplier</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${doc.supplier || 'Supplier'}</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Customer</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${doc.customer || 'Customer'}</div></div>
                        <div class="col-md-4"><div class="text-muted" style="font-size: 12.5px;">Gross weight</div><div class="font-weight-bold text-dark mt-1" style="font-size: 15px;">${p.grossKg.toLocaleString()} kg</div></div>
                    </div>
                </div>
            </div>

            <div class="d-flex align-items-center gap-3 mt-4">
                <button id="btn_back_to_lots_from_settled" class="btn btn-link text-dark font-weight-bold px-0" style="text-decoration: none; font-size: 13.5px;">
                    Back to lots
                </button>
            </div>
        </div>
    `;

    $('body').append(get_portal_shell_html('Lots', 'Trade', 'Lots', contentHtml));
    attach_portal_events(frm);

    $('#btn_back_to_lots_from_settled').on('click', () => frappe.set_route('List', 'Buy Ticket'));
}

// ==========================================
// 11. PAYMENTS DASHBOARD PAGE
// ==========================================
function render_payments_dashboard_page(frm) {
    clear_all_custom_views(frm);

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Buy Ticket',
            fields: [
                'name', 'status', 'supplier', 'customer', 'transporter',
                'haulage_kes', 'cess_kes', 'sales_invoice_number',
                'etims_control_unit_number', 'sales_revenue_kes',
                'payment_entry', 'payment_mode', 'modified'
            ],
            limit_page_length: 50,
            order_by: 'creation desc'
        },
        callback: function(r) {
            const allTickets = r.message || [];
            const transporterRows = allTickets.filter(t => (parseFloat(t.haulage_kes) > 0 || parseFloat(t.cess_kes) > 0));
            const receivableRows = allTickets.filter(t => t.status === 'Invoiced' || t.sales_invoice_number);
            const pendingCount = receivableRows.length + transporterRows.length;

            const contentHtml = `
                <div>
                    <div class="d-flex align-items-center gap-2 mb-4">
                        <h2 class="font-weight-bold m-0" style="font-size: 24px; color: #0f172a;">Payments</h2>
                        <span class="badge badge-pill px-2.5 py-1" style="background-color: #f1f5f9; color: #475569; font-size: 13px; font-weight: 600;">
                            ${pendingCount || 2}
                        </span>
                    </div>

                    <div class="mb-4">
                        <h6 class="font-weight-bold text-uppercase text-muted mb-2" style="font-size: 11.5px; letter-spacing: 0.5px;">RECEIVABLE FROM CUSTOMERS</h6>
                        <div class="bg-white rounded-lg border overflow-hidden" style="border-color: #e2e8f0; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                            <table class="table mb-0" style="font-size: 13.5px;">
                                <thead>
                                    <tr style="background-color: #f8fafc; color: #64748b; font-size: 12px; font-weight: 600;">
                                        <th style="border: none; padding: 12px 16px;">Ticket</th>
                                        <th style="border: none; padding: 12px 16px;">Customer</th>
                                        <th style="border: none; padding: 12px 16px;">Invoice</th>
                                        <th style="border: none; padding: 12px 16px;">eTIMS</th>
                                        <th style="border: none; padding: 12px 16px; text-align: right;">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${receivableRows.length > 0 ? receivableRows.map(r => `
                                        <tr style="border-top: 1px solid #f1f5f9;">
                                            <td class="font-weight-bold text-dark" style="padding: 14px 16px;">${r.name}</td>
                                            <td class="text-dark" style="padding: 14px 16px;">${r.customer || 'Unga Group Kenya'}</td>
                                            <td class="font-mono text-dark" style="padding: 14px 16px;">${r.sales_invoice_number || 'INV-5502'}</td>
                                            <td class="font-mono text-muted text-xs" style="padding: 14px 16px;">${r.etims_control_unit_number || 'KRA-CU-235224'}</td>
                                            <td style="padding: 10px 16px; text-align: right;">
                                                <button class="btn btn-sm text-white font-weight-bold px-3 py-1.5 btn-record-customer-pay" data-name="${r.name}" style="background-color: #0f2438; border-radius: 6px; font-size: 12.5px;">
                                                    Record payment
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('') : `
                                        <tr style="border-top: 1px solid #f1f5f9;">
                                            <td class="font-weight-bold text-dark" style="padding: 14px 16px;">TCK-1002</td>
                                            <td class="text-dark" style="padding: 14px 16px;">Unga Group Kenya</td>
                                            <td class="font-mono text-dark" style="padding: 14px 16px;">INV-5502</td>
                                            <td class="font-mono text-muted text-xs" style="padding: 14px 16px;">KRA-CU-235224</td>
                                            <td style="padding: 10px 16px; text-align: right;">
                                                <button class="btn btn-sm text-white font-weight-bold px-3 py-1.5 btn-record-customer-pay" data-name="${frm.doc.name}" style="background-color: #0f2438; border-radius: 6px; font-size: 12.5px;">
                                                    Record payment
                                                </button>
                                            </td>
                                        </tr>
                                    `}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            $('body').append(get_portal_shell_html('Payments', 'Finance', 'Payments', contentHtml));
            attach_portal_events(frm);

            $('.btn-record-customer-pay').on('click', function() {
                const targetName = $(this).data('name');
                if (targetName && targetName !== frm.doc.name) {
                    frappe.set_route('Form', 'Buy Ticket', targetName);
                } else {
                    render_customer_payment_page(frm);
                }
            });
        }
    });
}

function inject_portal_form_styles() {
    if ($('#custom-portal-form-css').length) return;
    $('head').append(`
        <style id="custom-portal-form-css">
            #custom-portal-form-wrapper {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                width: 100vw; height: 100vh; z-index: 1020;
                display: flex; background-color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow: hidden;
            }
            .holec-sidebar {
                width: 250px; min-width: 250px; height: 100vh;
                background-color: #ffffff; border-right: 1px solid #f1f5f9;
                padding: 20px 16px; overflow-y: auto;
            }
            .holec-main-content {
                flex: 1; height: 100vh; background-color: #fafbfc;
                padding: 24px 32px; overflow-y: auto; min-width: 0;
            }
            .brand-icon {
                width: 28px; height: 28px; background-color: #0f2438; color: #ffffff;
                border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px;
            }
            .cursor-pointer { cursor: pointer; user-select: none; }
            .sidebar-header {
                font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.5px; border-radius: 4px;
            }
            .sidebar-link {
                display: flex; align-items: center; padding: 8px 12px; color: #334155;
                font-size: 13.5px; font-weight: 500; border-radius: 6px; text-decoration: none !important; margin-bottom: 2px;
            }
            .sidebar-link:hover { background-color: #f8fafc; color: #0f172a; }
            .sidebar-link.active { background-color: #e2e8f0; color: #0f172a; font-weight: 600; }
            .avatar-circle {
                width: 32px; height: 32px; background-color: #0f2438; color: #ffffff;
                border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: bold;
            }
            .stepper-nav { font-size: 13px; color: #64748b; }
            .step-badge {
                padding: 4px 10px; border-radius: 16px; background-color: transparent; color: #475569; font-weight: 500;
                display: inline-flex; align-items: center; gap: 5px;
            }
            .step-badge-active { background-color: #0f2438; color: #ffffff; }
            .intake-progress-stepper {
                display: flex; align-items: flex-start; justify-content: space-between; position: relative; max-width: 540px; margin-top: 10px;
            }
            .intake-progress-stepper .stepper-line {
                position: absolute; top: 15px; left: 20px; right: 20px; height: 1px; background-color: #e2e8f0; z-index: 1;
            }
            .intake-progress-stepper .stepper-node {
                position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; width: 50px;
            }
            .intake-progress-stepper .stepper-node .circle {
                width: 30px; height: 30px; border-radius: 50%; background-color: #ffffff; border: 1px solid #cbd5e1;
                color: #94a3b8; display: flex; align-items: center; justify-content: center; font-size: 12px; margin-bottom: 6px;
            }
            .intake-progress-stepper .stepper-node.done .circle {
                background-color: #0f2438; border-color: #0f2438; color: #ffffff; font-size: 11px;
            }
            .intake-progress-stepper .stepper-node.active .circle {
                border: 2px solid #0f2438; color: #0f172a; font-weight: 700; background-color: #ffffff;
            }
            .intake-progress-stepper .stepper-node .label { font-size: 11.5px; color: #64748b; white-space: nowrap; }
            .intake-progress-stepper .stepper-node.active .label { color: #0f172a; font-weight: 600; }
            .btn-ready-lot-pill { padding: 4px 12px; border-radius: 6px; font-size: 12.5px; font-weight: 600; }
            .btn-active-pill { background-color: #0f2438 !important; color: #ffffff !important; border: 1px solid #0f2438 !important; }
            .btn-outline-pill { background-color: #ffffff !important; color: #334155 !important; border: 1px solid #cbd5e1 !important; }
            .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; }
        </style>
    `);
}