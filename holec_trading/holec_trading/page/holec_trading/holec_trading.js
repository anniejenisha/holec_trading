frappe.pages['holec_trading'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Holec Trading',
        single_column: true
    });
    $(frappe.render_template('holec_trading', {})).appendTo(page.main);
    $(page.wrapper).find('.page-head').hide();
    $(page.wrapper).find('.layout-side-section').remove();
    $(page.wrapper).find('.desk-sidebar').remove();
    $(page.main).css({ 'width': '100%', 'margin': '0', 'padding': '0' });
    $(page.main).html(`
        <div class="holec-layout" style="display:flex; width:100%; height:100vh; background:#f4f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; position:absolute; top:0; left:0; right:0; bottom:0; overflow:hidden;">
            <div class="holec-sidebar" id="h-sidebar" style="width:240px; background:#ffffff; border-right:1px solid #e2e8f0; padding:16px 12px; overflow-y:auto; flex-shrink:0;"></div>
            <div class="holec-main-container" style="flex-grow:1; display:flex; flex-direction:column; overflow:hidden; min-width:0;">
                <div class="holec-topbar" style="height:56px; background:#ffffff; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; padding:0 24px; flex-shrink:0;">
                    <div class="holec-timeline" id="h-timeline" style="display:flex; align-items:center; gap:6px; font-size:13px; color:#4a5568;"></div>
                </div>
                <div class="holec-content" id="h-content" style="flex-grow:1; overflow-y:auto; padding:24px; width:100%;"></div>
            </div>
        </div>
    `);

    init_holec_trading_engine();
};

function init_holec_trading_engine() {
    const fmtKES = (n) => 'KES ' + Math.round(flt(n)).toLocaleString('en-KE');
    const fmtKg = (n) => Math.round(flt(n)).toLocaleString('en-KE') + ' kg';
    const fmtKg1 = (n) => flt(n).toLocaleString('en-KE', { maximumFractionDigits: 1 }) + ' kg';

    const STAGE_ORDER = ['Ticket', 'Intake', 'Lot', 'Position', 'Invoiced', 'Settled'];
    const COMPANY = 'Holec (E.A.) Limited';

    // Data field on Customer that holds the unique Customer ID (create it, mark Unique)
    const CUSTOMER_ID_FIELD = 'alias';

    const BTN_PRIMARY = 'background:#1a202c;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;';
    const BTN_GHOST = 'background:transparent;color:#4a5568;border:none;padding:10px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;';
    const BTN_OUTLINE = 'background:#ffffff;color:#1a202c;border:1px solid #cbd5e0;padding:9px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;';
    const CARD_BOX = 'background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;margin-bottom:24px;';

    // Escapes text for safe use inside HTML
    const escHtml = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const LIVE_STORE = {
        suppliers: [],
        customers: [],
        customer_groups: [],
        countries: [],
        items: [],
        vehicles: [],
        lots: [],
        lotEventLogs: [],
        banks: [],
        bank_branches: [],
        origin_area: [],
        origin_county: [],
        branch: []
    };

    let route = { module: 'lots', params: {} };

    // =====================================================================
    // BUSINESS RULES - change here, not in the screens
    // =====================================================================
    const PAYABLE_RULES = {
        moistureStandard: 13.5,   // % moisture the price is based on
        fmAllowance: 0.5,         // % foreign matter tolerated before any deduction
        fmFactor: 1.5,            // each 1% FM above the allowance removes 1.5% of weight
        defaultRate: 48           // KES/kg when the ticket has no negotiated price
    };

    // Supplier side: net weight x reference rate
    function computePayable(lot, rateOverride) {
        const R = PAYABLE_RULES;
        const grossKg = flt(lot.gross_weight_kg || lot.quantity_kg || 0);
        const tareKg = flt(lot.tare_weight_kg || 0);
        const netKg = Math.max(0, grossKg - tareKg);
        const moisture = flt(lot.moisture_ || 0);
        const fm = flt(lot.foreign_matter_ || 0);

        // Moisture: points over standard x a multiplier that grows with wetness
        const moistureExcess = Math.max(0, moisture - R.moistureStandard);
        let moistureMultiplier = 0;
        if (moisture > 20) moistureMultiplier = 1.6;
        else if (moisture > 14) moistureMultiplier = 1.2;
        else if (moisture > R.moistureStandard) moistureMultiplier = 1.0;
        const moisturePenaltyPct = moistureExcess * moistureMultiplier;
        const moistureDeductionKg = netKg * (moisturePenaltyPct / 100);

        // Foreign matter: only the part above the allowance counts, times the factor
        const fmExcess = Math.max(0, fm - R.fmAllowance);
        const fmPenaltyPct = fmExcess * R.fmFactor;
        const fmDeductionKg = netKg * (fmPenaltyPct / 100);

        // Stock quantity after deductions (does NOT change the amount paid)
        const acceptedNetKg = Math.max(0, netKg - moistureDeductionKg - fmDeductionKg);

        const refRate = flt(rateOverride != null ? rateOverride : (lot.negotiated_price || R.defaultRate));
        const bags = cint(lot.bag_count || 0);

        // Net payable = net weight (gross - tare) x reference rate
        const grossValue = netKg * refRate;
        const netPayable = grossValue;

        const totalTransport = flt(lot.haulage_kes) + flt(lot.cess_kes) + flt(lot.offloading_kes);
        const landedCostPerKg = netKg > 0 ? Math.round((netPayable + totalTransport) / netKg) : refRate;

        return {
            grossKg, tareKg, netKg, moisture, fm, bags,
            moistureExcess, moistureMultiplier, moisturePenaltyPct, moistureDeductionKg,
            fmExcess, fmPenaltyPct, fmDeductionKg,
            acceptedNetKg, refRate, grossValue,
            netPayable, totalTransport, landedCostPerKg
        };
    }

    // One place for revenue / landed cost / margin so every screen agrees
    function computeMargin(lot, sellRateOverride) {
        const p = computePayable(lot);
        const buyKg = p.netKg;   // supplier weighbridge: gross - tare
        // customer weighbridge: gross - tare (falls back to the saved delivered quantity)
        const soldKg = Math.max(0, flt(lot.delivery_gross_kg) - flt(lot.delivery_tare_kg)) || flt(lot.delivered_quantity_kg);
        const sellRate = flt(sellRateOverride != null ? sellRateOverride : lot.sell_rate);
        const refRate = p.refRate;
        const revenue = soldKg * sellRate;          // customer net weight x sell rate
        const landedCost = buyKg * sellRate;         // supplier net weight x reference rate
        const margin = revenue - landedCost;
        const marginPerTonne = soldKg > 0 ? margin / (soldKg / 1000) : 0;
        return { buyKg, soldKg, sellRate, refRate, revenue, landedCost, margin, marginPerTonne };
    }

    function showToast(msg, indicator = 'green') {
        frappe.show_alert({ message: msg, indicator: indicator });
    }

    function statusBadge(st) {
        const stateLower = (st || 'Ticket').toLowerCase();
        let bg = '#edf2f7';
        let color = '#4a5568';
        let dotColor = '#cbd5e0';

        if (stateLower === 'intake') { bg = '#fffaf0'; color = '#9c4221'; dotColor = '#dd6b20'; }
        else if (stateLower === 'lot') { bg = '#ebf8ff'; color = '#2b6cb0'; dotColor = '#3182ce'; }
        else if (['position', 'invoiced', 'settled'].includes(stateLower)) { bg = '#f0fff4'; color = '#276749'; dotColor = '#38a169'; }

        return `<span style="display:inline-flex;align-items:center;gap:6px;background:${bg};color:${color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:500;"><span style="width:6px;height:6px;background:${dotColor};border-radius:50%;"></span>${st || 'Ticket'}</span>`;
    }

    function field(opts) {
        const { label, id, type = 'text', value = '', required = false, options = null, placeholder = '', span = false } = opts;
        const reqMark = required ? '<span style="color:#e53e3e;margin-left:2px;">*</span>' : '';
        const cleanLabel = label.replace(/\s*\*$/, '');
        let input;

        if (type === 'select') {
            const opts_html = (options || []).map(o => {
                const val = typeof o === 'object' ? o.value : o;
                const lbl = typeof o === 'object' ? o.label : o;
                return `<option value="${val}" ${val === value ? 'selected' : ''}>${lbl}</option>`;
            }).join('');
            input = `<select id="${id}" style="width:100%;padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;font-size:14px;"><option value="">Select...</option>${opts_html}</select>`;
        } else if (type === 'textarea') {
            return `<div style="${span ? 'grid-column: span 2;' : ''}display:flex;flex-direction:column;gap:8px;"><label for="${id}" style="font-size:13px;font-weight:500;color:#4a5568;">${cleanLabel} ${reqMark}</label><textarea id="${id}" placeholder="${placeholder}" style="width:100%;padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;min-height:80px;">${value}</textarea></div>`;
        } else {
            input = `<input type="${type}" id="${id}" value="${value}" placeholder="${placeholder}" style="width:100%;padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;">`;
        }
        return `<div style="${span ? 'grid-column: span 2;' : ''}display:flex;flex-direction:column;gap:8px;"><label for="${id}" style="font-size:13px;font-weight:500;color:#4a5568;">${cleanLabel} ${reqMark}</label>${input}</div>`;
    }

    async function loadMasterData() {
        try {
            const [suppliers, customers, customerGroups, countries, items, vehicles, buyTickets, lotEventLogs, banks, bankBranches, origin_area, origin_county, branch] = await Promise.all([
                    frappe.db.get_list('Supplier', {
                        filters: { supplier_group: ['in', ['Transporter', 'Farmer', 'CESS']] },
                        fields: ['name', 'supplier_name', 'supplier_group', 'country', 'tax_id'],
                        limit: 500
                    }),                
                    frappe.db.get_list('Customer', {
                        filters: { customer_group: 'Holec Trading' },
                        fields: ['name', 'customer_name', 'customer_group', 'payment_terms', 'disabled'],
                        limit: 500
                    }),
                frappe.db.get_list('Customer Group', { fields: ['name', 'customer_group_name'], order_by: 'name asc', limit: 500 }),
                frappe.db.get_list('Country', { fields: ['name', 'country_name'], limit: 250, order_by: 'name asc' }),
                frappe.db.get_list('Item', {
                    filters: { item_group: 'Holec Trading' },
                    fields: ['name', 'item_name', 'item_group'],
                    limit: 500,
                    order_by: 'item_name asc'
                }),
                frappe.db.get_list('Vehicle', { fields: ['name', 'license_plate'], order_by: 'name asc', limit: 500 }),
                frappe.db.get_list('Buy Ticket', {
                    fields: [
                        'name', 'status', 'supplier', 'customer', 'commodity', 'region',
                        'quantity_kg', 'negotiated_price', 'creation', 'modified',
                        'gross_weight_kg', 'tare_weight_kg', 'bag_count',
                        'weighbridge_ticket_number', 'transporter', 'vehicle_registration',
                        'moisture_', 'foreign_matter_', 'aflatoxin_ppb',
                        'county', 'reason_code_if_foreign_matter_judgement_or_wet_buy',
                        'haulage_kes', 'cess_kes', 'offloading_kes', 'delivered_quantity_kg',
                        'sell_rate', 'invoice_number', 'delivery_gross_kg', 'delivery_tare_kg',
                        'transport_paid'
                    ],
                    order_by: 'creation desc',
                    limit: 500
                }),
                frappe.db.get_list('Lot Event Log', {
                    fields: ['name', 'lot', 'state', 'owner', 'modified', 'creation'],
                    order_by: 'creation desc',
                    limit: 100
                }).catch(() => []),
                frappe.db.get_list('Bank', { fields: ['name', 'bank_name'], order_by: 'name asc', limit: 500 }).catch(() => []),
                frappe.db.get_list('Bank Branch', { fields: ['name', 'branch_name', 'bank'], limit: 500, order_by: 'name asc' }).catch(() => []),
                frappe.db.get_list('Origin Area', { fields: ['name'], order_by: 'name asc', limit: 500 }).catch(() => []),
                frappe.db.get_list('Origin County', { fields: ['name'], order_by: 'name asc', limit: 500 }).catch(() => []),
                frappe.db.get_list('Bank Branch', { fields: ['name', 'branch_name', 'bank'], order_by: 'name asc', limit: 500 }).catch(() => []),
            ]);

            LIVE_STORE.suppliers = suppliers || [];
            LIVE_STORE.customers = customers || [];
            LIVE_STORE.customer_groups = customerGroups || [];
            LIVE_STORE.countries = countries || [];
            LIVE_STORE.items = items || [];
            LIVE_STORE.vehicles = vehicles || [];
            LIVE_STORE.lots = buyTickets || [];
            LIVE_STORE.lotEventLogs = lotEventLogs || [];
            LIVE_STORE.banks = banks || [];
            LIVE_STORE.bank_branches = bankBranches || [];
            LIVE_STORE.origin_area = origin_area || [];
            LIVE_STORE.origin_county = origin_county || [];
            LIVE_STORE.branch = branch || [];
        } catch (e) {
            console.error('Error loading master data from DocTypes:', e);
        }
    }

    window.navigate = function (moduleId, params = {}) {
        route = { module: moduleId, params };
        render();
        $('.holec-content').scrollTop(0);
    };

    // =====================================================================
    // INVOICE TEMPLATE (printable sales invoice)
    //   - Bank details come from Bank Account records linked to the company
    //   - Customer block shows the unique Customer ID (CUSTOMER_ID_FIELD)
    // =====================================================================
    async function loadInvoiceTemplateData(l) {
        const data = { si: null, customer: null, customerAddress: '', company: null, bankAccounts: [] };

        // Sales Invoice
        if (l.invoice_number) {
            try { data.si = await frappe.db.get_doc('Sales Invoice', l.invoice_number); }
            catch (e) { console.error('Invoice template: Sales Invoice load failed', e); }
        }

        // Customer (unique ID, KRA PIN, contacts, delivery points)
        const customerName = (data.si && data.si.customer) || l.customer;
        if (customerName) {
            try { data.customer = await frappe.db.get_doc('Customer', customerName); }
            catch (e) { console.error('Invoice template: Customer load failed', e); }
        }
        if (data.customer && data.customer.customer_primary_address) {
            try {
                const r = await frappe.call({
                    method: 'frappe.contacts.doctype.address.address.get_address_display',
                    args: { address_dict: data.customer.customer_primary_address }
                });
                data.customerAddress = (r && r.message) || '';
            } catch (e) { console.warn('Invoice template: customer address not loaded', e); }
        }

        // Company header details
        try {
            const r = await frappe.db.get_value('Company', COMPANY, ['company_name', 'tax_id', 'email', 'phone_no', 'website']);
            data.company = (r && r.message) || null;
        } catch (e) { console.warn('Invoice template: company details not loaded', e); }

        // Company bank accounts: Bank Account records that belong to this company.
        // Account details come from Bank Account; bank name, SWIFT, bank code and address
        // come from the Bank record; branch name comes from Bank Branch.
        try {
            const acctRows = await frappe.db.get_list('Bank Account', {
                filters: { company: COMPANY, is_company_account: 1, disabled: 0 },
                fields: ['name', 'is_default'],
                order_by: 'is_default desc, creation asc',
                limit: 20
            }) || [];

            const stripHtml = (h) => String(h || '')
                .replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, '')
                .replace(/\s*,\s*(,\s*)+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
            const pick = (o, keys) => { for (const k of keys) { if (o && o[k]) return o[k]; } return ''; };
            const bankCache = {};

            for (const row of acctRows) {
                let acct = {};
                try { acct = await frappe.db.get_doc('Bank Account', row.name); }
                catch (e) { console.error('Bank Account load failed', row.name, e); continue; }

                // Bank record (bank name, SWIFT, bank code, address)
                let bank = {}, bankAddress = '';
                if (acct.bank) {
                    if (!bankCache[acct.bank]) {
                        const entry = { doc: {}, address: '' };
                        try { entry.doc = await frappe.db.get_doc('Bank', acct.bank); } catch (e) { console.warn('Bank load failed', e); }
                        try {
                            const addrs = await frappe.db.get_list('Address', {
                                filters: [['Dynamic Link', 'link_doctype', '=', 'Bank'], ['Dynamic Link', 'link_name', '=', acct.bank]],
                                fields: ['name'],
                                limit: 1
                            });
                            if (addrs && addrs.length) {
                                const r = await frappe.call({
                                    method: 'frappe.contacts.doctype.address.address.get_address_display',
                                    args: { address_dict: addrs[0].name }
                                });
                                entry.address = stripHtml(r && r.message);
                            }
                        } catch (e) { console.warn('Bank address not loaded', e); }
                        bankCache[acct.bank] = entry;
                    }
                    bank = bankCache[acct.bank].doc;
                    bankAddress = bankCache[acct.bank].address;
                }

                // Branch record: Bank Branch documents are linked to the Bank (Bank Branch.bank)
                let branch = {};
                try {
                    const branchLink = pick(acct, ['bank_branch', 'custom_bank_branch', 'branch']);
                    let branchName = branchLink;
                    if (!branchName && acct.bank) {
                        const branches = await frappe.db.get_list('Bank Branch', {
                            filters: { bank: acct.bank },
                            fields: ['name'],
                            order_by: 'name asc',
                            limit: 50
                        }) || [];
                        if (branches.length === 1) {
                            branchName = branches[0].name;
                        } else if (branches.length > 1) {
                            // Several branches on this bank: match the account's branch code
                            for (const br of branches) {
                                const doc = await frappe.db.get_doc('Bank Branch', br.name);
                                if (acct.branch_code && String(pick(doc, ['branch_code', 'custom_branch_code'])) === String(acct.branch_code)) {
                                    branch = doc;
                                    break;
                                }
                            }
                            if (!branch.name) console.warn('Several Bank Branch records for', acct.bank, '- none matches branch code', acct.branch_code);
                        }
                    }
                    if (branchName && !branch.name) branch = await frappe.db.get_doc('Bank Branch', branchName);
                } catch (e) { console.warn('Bank Branch load failed', e); }

                data.bankAccounts.push({
                    account_name: acct.account_name || '',
                    account_no: acct.bank_account_no || '',
                    bank_name: bank.bank_name || acct.bank || '',
                    branch_name: branch.branch_name || pick(acct, ['branch_name', 'custom_branch_name']) || '',
                    bank_address: bankAddress || pick(bank, ['address', 'bank_address', 'custom_address']),
                    swift: pick(bank, ['swift_number', 'swift_code', 'custom_swift_code']),
                    bank_code: pick(bank, ['bank_code', 'custom_bank_code']) || pick(acct, ['bank_code', 'custom_bank_code']),
                    branch_code: pick(acct, ['branch_code', 'custom_branch_code']) || pick(branch, ['branch_code', 'custom_branch_code'])
                });
            }
        } catch (e) {
            console.error('Invoice template: Bank Account load failed', e);
        }

        return data;
    }

    function buildInvoiceHtml(l, d) {
        const si = d.si;
        const cust = d.customer || {};
        const m = computeMargin(l);

        // Customer details with the unique ID
        const customerId = cust[CUSTOMER_ID_FIELD] || '';
        const customerName = cust.customer_name || l.customer || '';
        const customerPin = cust.tax_id || cust.custom_kra_pin || '';
        const primaryContact = (cust.custom_holec_contacts || []).find(c => cint(c.is_primary)) || (cust.custom_holec_contacts || [])[0] || null;
        const deliveryPoint = (cust.custom_holec_delivery_points || [])[0] || null;

        // Lines: use the real invoice items when present, otherwise rebuild from the ticket
        let lines = [];
        if (si && (si.items || []).length) {
            lines = si.items.map(it => ({
                desc: it.item_name || it.item_code || l.commodity || 'Commodity',
                qty: flt(it.qty),
                rate: flt(it.rate),
                amount: flt(it.amount)
            }));
        } else {
            lines = [{ desc: l.commodity || 'Commodity', qty: m.soldKg, rate: m.sellRate, amount: m.revenue }];
        }
        const subTotal = lines.reduce((a, x) => a + flt(x.amount), 0);
        const grandTotal = si && flt(si.grand_total) ? flt(si.grand_total) : subTotal;
        const taxTotal = Math.max(0, grandTotal - subTotal);

        const invoiceNo = (si && si.name) || l.invoice_number || '';
        const postingDate = si && si.posting_date ? frappe.datetime.str_to_user(si.posting_date) : frappe.datetime.str_to_user(frappe.datetime.get_today());
        const dueDate = si && si.due_date ? frappe.datetime.str_to_user(si.due_date) : '';
        const terms = (si && si.payment_terms_template) || cust.payment_terms || '';

        const co = d.company || {};
        const companyName = co.company_name || COMPANY;

        const bankRow = (label, value) => `<tr><td class="bl">${label}</td><td class="bv">${escHtml(String(value || '').toUpperCase())}</td></tr>`;
        const bankBlocks = d.bankAccounts.length
            ? d.bankAccounts.map(b => `
                <table class="bank-table">
                    ${bankRow('Account Name', b.account_name || companyName)}
                    ${bankRow('KES Account number', b.account_no)}
                    ${bankRow('Bank Name', b.bank_name)}
                    ${bankRow('Branch Name', b.branch_name)}
                    ${bankRow('Address of the Bank', b.bank_address)}
                    ${bankRow('Swift code', b.swift)}
                    ${bankRow('Bank Code', b.bank_code)}
                    ${bankRow('Branch Code', b.branch_code)}
                </table>`).join('')
            : `<div class="muted">No company Bank Account found for ${escHtml(companyName)}. Add one in Bank Account (tick "Is Company Account").</div>`;

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${escHtml(invoiceNo)}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:#1a202c; margin:0; padding:32px; font-size:13px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1a202c; padding-bottom:16px; margin-bottom:20px; }
    .head h1 { margin:0 0 4px 0; font-size:22px; }
    .title { text-align:right; }
    .title h2 { margin:0 0 6px 0; font-size:20px; letter-spacing:0.05em; }
    .muted { color:#718096; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:20px; }
    .box { border:1px solid #e2e8f0; border-radius:6px; padding:14px 16px; }
    .box h4 { margin:0 0 8px 0; font-size:11px; letter-spacing:0.06em; color:#718096; }
    .row { display:flex; justify-content:space-between; gap:16px; padding:3px 0; }
    .row span { color:#718096; }
    table { width:100%; border-collapse:collapse; margin-bottom:16px; }
    th { background:#f8fafc; text-align:left; padding:10px 12px; border-bottom:1px solid #e2e8f0; font-size:12px; color:#4a5568; }
    td { padding:10px 12px; border-bottom:1px solid #edf2f7; }
    .r { text-align:right; }
    .totals { margin-left:auto; width:300px; }
    .totals .row { border-bottom:1px solid #edf2f7; padding:6px 0; }
    .totals .grand { font-size:15px; font-weight:700; border-bottom:2px solid #1a202c; }
    .bank-table { width:100%; border-collapse:collapse; margin:0 0 12px 0; }
    .bank-table td { border:1px solid #1a202c; padding:5px 10px; font-size:13px; }
    .bank-table .bl { width:38%; }
    .bank-table .bv { font-weight:700; }
    .foot { margin-top:28px; font-size:11px; color:#718096; border-top:1px solid #e2e8f0; padding-top:12px; }
    @media print { body { padding:16px; } }
</style>
</head>
<body>
    <div class="head">
        <div>
            <h1>${escHtml(companyName)}</h1>
            ${co.tax_id ? `<div class="muted">KRA PIN: ${escHtml(co.tax_id)}</div>` : ''}
            ${co.email ? `<div class="muted">${escHtml(co.email)}</div>` : ''}
            ${co.phone_no ? `<div class="muted">${escHtml(co.phone_no)}</div>` : ''}
            ${co.website ? `<div class="muted">${escHtml(co.website)}</div>` : ''}
        </div>
        <div class="title">
            <h2>SALES INVOICE</h2>
            <div class="row"><span>Invoice No.</span><b>${escHtml(invoiceNo)}</b></div>
            <div class="row"><span>Date</span><b>${escHtml(postingDate)}</b></div>
            ${dueDate ? `<div class="row"><span>Due Date</span><b>${escHtml(dueDate)}</b></div>` : ''}
            <div class="row"><span>Ticket</span><b>${escHtml(l.name)}</b></div>
        </div>
    </div>

    <div class="grid">
        <div class="box">
            <h4>BILL TO</h4>
            <div style="font-size:15px;font-weight:700;margin-bottom:6px;">${escHtml(customerName)}</div>
            <div class="row"><span>Customer ID</span><b>${escHtml(customerId || '—')}</b></div>
            <div class="row"><span>KRA PIN</span><b>${escHtml(customerPin || '—')}</b></div>
            ${terms ? `<div class="row"><span>Payment Terms</span><b>${escHtml(terms)}</b></div>` : ''}
            ${d.customerAddress ? `<div style="margin-top:6px;" class="muted">${d.customerAddress}</div>` : ''}
            ${deliveryPoint ? `<div style="margin-top:6px;"><span class="muted">Delivery point:</span> ${escHtml(deliveryPoint.delivery_point_name || '')}${deliveryPoint.location ? ', ' + escHtml(deliveryPoint.location) : ''}</div>` : ''}
            ${primaryContact ? `<div style="margin-top:6px;"><span class="muted">Contact:</span> ${escHtml(primaryContact.contact_name || '')}${primaryContact.phone ? ' · ' + escHtml(primaryContact.phone) : ''}</div>` : ''}
        </div>
        <div class="box">
            <h4>DELIVERY DETAILS</h4>
            <div class="row"><span>Commodity</span><b>${escHtml(l.commodity || '—')}</b></div>
            <div class="row"><span>Net weight delivered</span><b>${escHtml(fmtKg1(m.soldKg))}</b></div>
            <div class="row"><span>Vehicle</span><b>${escHtml(l.vehicle_registration || '—')}</b></div>
            <div class="row"><span>Weighbridge ticket</span><b>${escHtml(l.weighbridge_ticket_number || '—')}</b></div>
        </div>
    </div>

    <table>
        <thead><tr><th>Description</th><th class="r">Quantity (kg)</th><th class="r">Rate (KES/kg)</th><th class="r">Amount (KES)</th></tr></thead>
        <tbody>
            ${lines.map(x => `
            <tr>
                <td>${escHtml(x.desc)}</td>
                <td class="r">${flt(x.qty).toLocaleString('en-KE', { maximumFractionDigits: 1 })}</td>
                <td class="r">${flt(x.rate).toLocaleString('en-KE', { maximumFractionDigits: 2 })}</td>
                <td class="r">${Math.round(flt(x.amount)).toLocaleString('en-KE')}</td>
            </tr>`).join('')}
        </tbody>
    </table>

    <div class="totals">
        <div class="row"><span>Sub total</span><b>${fmtKES(subTotal)}</b></div>
        ${taxTotal > 0 ? `<div class="row"><span>Tax</span><b>${fmtKES(taxTotal)}</b></div>` : ''}
        <div class="row grand"><span>Total due</span><span>${fmtKES(grandTotal)}</span></div>
    </div>

    <div class="box" style="margin-top:24px;">
        <h4>PAYMENT DETAILS</h4>
        ${bankBlocks}
    </div>

    <div class="foot">
        Transmitted via eTIMS. Thank you for your business.
    </div>
</body>
</html>`;
    }

    async function printInvoiceTemplate(l) {
        // Open the window first so the browser doesn't treat it as a blocked popup
        const win = window.open('', '_blank');
        if (!win) {
            showToast('Allow pop-ups for this site to open the invoice.', 'orange');
            return;
        }
        win.document.write('<p style="font-family:sans-serif;padding:24px;">Preparing invoice...</p>');

        try {
            const data = await loadInvoiceTemplateData(l);

            if (!data.customer) {
                showToast('Customer record could not be loaded. Customer ID will be blank.', 'orange');
            } else if (!data.customer[CUSTOMER_ID_FIELD]) {
                showToast('This customer has no Customer ID set.', 'orange');
            }
            if (!data.bankAccounts.length) {
                showToast(`No company Bank Account found for ${COMPANY}.`, 'orange');
            }

            const html = buildInvoiceHtml(l, data);
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.focus();
            setTimeout(() => win.print(), 400);
        } catch (err) {
            console.error('Invoice template error:', err);
            win.close();
            showToast('Failed to build the invoice template.', 'red');
        }
    }

    // =====================================================================
    // SUPPLIERS
    // =====================================================================
    function renderSuppliers(container) {
        const searchTerm = container._searchQuery || '';
        const suppliers = (LIVE_STORE.suppliers || []).filter(s => {
            const nameMatch = (s.supplier_name || '').toLowerCase().includes(searchTerm.toLowerCase());
            const idMatch = (s.name || '').toLowerCase().includes(searchTerm.toLowerCase());
            const pinMatch = (s.tax_id || '').toLowerCase().includes(searchTerm.toLowerCase());
            return nameMatch || idMatch || pinMatch;
        });

        const rows = suppliers.map(s => {
            let bg = '#edf2f7';
            let color = '#4a5568';
            let dotColor = '#cbd5e0';
            let statusLabel = s.custom_status || 'Approved';

            if (statusLabel === 'Approved') { bg = '#f0fff4'; color = '#276749'; dotColor = '#38a169'; }
            else if (statusLabel === 'Verified') { bg = '#fffaf0'; color = '#9c4221'; dotColor = '#dd6b20'; }
            else if (statusLabel === 'Draft') { bg = '#edf2f7'; color = '#4a5568'; dotColor = '#a0aec0'; }

            const statusBadgeHtml = `<span style="display:inline-flex;align-items:center;gap:6px;background:${bg};color:${color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:500;"><span style="width:6px;height:6px;background:${dotColor};border-radius:50%;"></span>${statusLabel}</span>`;

            return `
                <tr style="border-bottom:1px solid #edf2f7;cursor:pointer;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding:14px 20px;font-family:monospace;font-weight:600;color:#2d3748;">${s.name}</td>
                    <td style="padding:14px 16px;color:#2d3748;font-weight:500;">${s.supplier_name || '—'}</td>
                    <td style="padding:14px 16px;color:#718096;">${s.supplier_group || '—'}</td>
                    <td style="padding:14px 16px;color:#718096;">${s.country || '—'}</td>
                    <td style="padding:14px 16px;font-family:monospace;color:#718096;">${s.tax_id || '—'}</td>
                    <td style="padding:14px 20px;">${statusBadgeHtml}</td>
                    <td style="padding:14px 20px;text-align:right;">
                        <a href="/app/supplier/${s.name}" target="_blank" class="h-btn sm" style="padding:4px 10px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;text-decoration:none;color:#2d3748;font-size:12px;font-weight:500;" onclick="event.stopPropagation();">Open ↗</a>
                    </td>
                </tr>`;
        }).join('');

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Parties</span> › <span style="color:#2d3748;font-weight:500;">Suppliers</span>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h1 style="margin:0;font-size:22px;font-weight:700;color:#1a202c;display:flex;align-items:center;gap:10px;">Suppliers <span style="background:#edf2f7;color:#4a5568;font-size:12px;padding:2px 8px;border-radius:10px;font-weight:600;">${suppliers.length}</span></h1>
                <button class="h-btn primary" id="new-supplier-btn" style="background:#1a202c;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">+ New supplier</button>
            </div>

            <div style="margin-bottom:20px;">
                <input type="text" id="supplier-search-input" value="${searchTerm}" placeholder="Search by Name" style="width:320px;padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;">
            </div>

            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:12px 20px;">ID ↕</th>
                            <th style="padding:12px 16px;">Name ↕</th>
                            <th style="padding:12px 16px;">Group ↕</th>
                            <th style="padding:12px 16px;">Country ↕</th>
                            <th style="padding:12px 16px;">KRA PIN</th>
                            <th style="padding:12px 20px;">Status</th>
                            <th style="padding:12px 20px;text-align:right;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || `<tr><td colspan="7" style="padding:30px;text-align:center;color:#718096;">No suppliers found.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;

        document.getElementById('new-supplier-btn').addEventListener('click', () => navigate('new_supplier'));

        const searchInput = document.getElementById('supplier-search-input');
        searchInput.addEventListener('input', (e) => {
            container._searchQuery = e.target.value;
            renderSuppliers(container);
            const updatedInput = document.getElementById('supplier-search-input');
            updatedInput.focus();
            updatedInput.setSelectionRange(updatedInput.value.length, updatedInput.value.length);
        });
    }

    // =====================================================================
    // CUSTOMERS
    // =====================================================================
    function renderCustomers(container) {
        const searchTerm = container._searchQuery || '';
        const customers = (LIVE_STORE.customers || []).filter(c => {
            const nameMatch = (c.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase());
            const idMatch = (c.name || '').toLowerCase().includes(searchTerm.toLowerCase());
            return nameMatch || idMatch;
        });

        const rows = customers.map(c => {
            const isDisabled = cint(c.disabled) === 1;
            const bg = isDisabled ? '#edf2f7' : '#f0fff4';
            const color = isDisabled ? '#4a5568' : '#276749';
            const dotColor = isDisabled ? '#a0aec0' : '#38a169';
            const statusLabel = isDisabled ? 'Disabled' : 'Approved';

            const statusBadgeHtml = `<span style="display:inline-flex;align-items:center;gap:6px;background:${bg};color:${color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:500;"><span style="width:6px;height:6px;background:${dotColor};border-radius:50%;"></span>${statusLabel}</span>`;

            const creditLimitVal = (c.credit_limits && c.credit_limits.length > 0) ? c.credit_limits[0].credit_limit : 0;
            const creditLimitStr = creditLimitVal ? `KES ${flt(creditLimitVal).toLocaleString('en-KE')}` : '—';

            return `
                <tr style="border-bottom:1px solid #edf2f7;cursor:pointer;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding:14px 20px;font-family:monospace;font-weight:600;color:#2d3748;">${c.name}</td>
                    <td style="padding:14px 16px;color:#2d3748;font-weight:500;">${c.customer_name || '—'}</td>
                    <td style="padding:14px 16px;color:#718096;">${c.customer_group || '—'}</td>
                    <td style="padding:14px 16px;color:#2d3748;text-align:right;">${creditLimitStr}</td>
                    <td style="padding:14px 16px;color:#718096;">${c.payment_terms || '—'}</td>
                    <td style="padding:14px 20px;">${statusBadgeHtml}</td>
                    <td style="padding:14px 20px;text-align:right;">
                        <a href="/app/customer/${c.name}" target="_blank" class="h-btn sm" style="padding:4px 10px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;text-decoration:none;color:#2d3748;font-size:12px;font-weight:500;" onclick="event.stopPropagation();">Open ↗</a>
                    </td>
                </tr>`;
        }).join('');

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Parties</span> › <span style="color:#2d3748;font-weight:500;">Customers</span>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h1 style="margin:0;font-size:22px;font-weight:700;color:#1a202c;display:flex;align-items:center;gap:10px;">Customers <span style="background:#edf2f7;color:#4a5568;font-size:12px;padding:2px 8px;border-radius:10px;font-weight:600;">${customers.length}</span></h1>
                <button class="h-btn primary" id="new-customer-btn" style="background:#1a202c;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">+ New customer</button>
            </div>

            <div style="margin-bottom:20px;">
                <input type="text" id="customer-search-input" value="${searchTerm}" placeholder="Search by Name" style="width:320px;padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;">
            </div>

            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:12px 20px;">ID ↕</th>
                            <th style="padding:12px 16px;">Name ↕</th>
                            <th style="padding:12px 16px;">Group ↕</th>
                            <th style="padding:12px 16px;text-align:right;">Credit Limit ↕</th>
                            <th style="padding:12px 16px;">Terms</th>
                            <th style="padding:12px 20px;">Status</th>
                            <th style="padding:12px 20px;text-align:right;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || `<tr><td colspan="7" style="padding:30px;text-align:center;color:#718096;">No customers found.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;

        document.getElementById('new-customer-btn').addEventListener('click', () => navigate('new_customer'));

        const searchInput = document.getElementById('customer-search-input');
        searchInput.addEventListener('input', (e) => {
            container._searchQuery = e.target.value;
            renderCustomers(container);
            const updatedInput = document.getElementById('customer-search-input');
            updatedInput.focus();
            updatedInput.setSelectionRange(updatedInput.value.length, updatedInput.value.length);
        });
    }

    // =====================================================================
    // NEW CUSTOMER
    // =====================================================================
    function renderNewCustomer(container) {
        // ---------- CONFIG ----------
        const KRA_LOOKUP_ENABLED = false;   // flip to true once GavaConnect API access exists
        const MAX_DELIVERY_POINTS = 5;      // set to 1 if Holec wants strictly ONE delivery point
        const MAX_CONTACTS = 3;
        const OCR_MIN_CONFIDENCE = 0.8;     // below this -> PIN Status = Manual
        const MAX_FILE_MB = 10;
        const DEFAULT_GROUP = 'Holec Trading';
        const DEFAULT_TERRITORY = 'All Territories';

        const KRA_REGEX = /^[AP]\d{9}[A-Z]$/;
        const PHONE_REGEX = /^(?:\+?254|0)[17]\d{8}$/;
        const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        // ---------- STATE ----------
        const state = {
            kraFile: null,
            crFile: null,
            pinStatus: null,
            nameTouched: false,
            pinDuplicate: false,
            deliveryPoints: [{ name: '', address: '' }],
            contacts: [{ name: '', role: '', phone: '', same_as_wa: true, whatsapp: '', email: '', is_primary: true }]
        };

        // ---------- STYLE HELPERS ----------
        const INPUT = 'width:100%;padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;background:#fff;box-sizing:border-box;';
        const CELL_INPUT = 'width:100%;padding:6px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;background:#fff;box-sizing:border-box;';
        const CARD = CARD_BOX;
        const SECTION = 'font-size:11px;font-weight:700;color:#a0aec0;letter-spacing:0.05em;';
        const HELP = 'font-size:12px;color:#718096;';
        const LABEL = 'font-size:13px;font-weight:500;color:#4a5568;';
        const TH = 'padding:10px 12px;text-align:left;color:#718096;font-weight:600;';
        const req = '<span style="color:#e53e3e;margin-left:2px;">*</span>';
        const opt = '<span style="color:#a0aec0;font-weight:400;margin-left:8px;font-size:12px;">(optional)</span>';
        const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const str = (v) => (v == null ? '' : String(v).trim());

        const fld = ({ label, id, required, optional, type = 'text', value = '', placeholder = '', hint = '', step, readonly }) => `
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label for="${id}" style="${LABEL}">${label}${required ? req : ''}${optional ? opt : ''}</label>
                <input type="${type}" id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}"
                    ${step ? `step="${step}"` : ''} ${readonly ? 'readonly' : ''} style="${INPUT}${readonly ? 'background:#f7fafc;' : ''}">
                ${hint ? `<div style="${HELP}">${hint}</div>` : ''}
            </div>`;

        const selectFld = ({ label, id, required, options = [], hint = '' }) => `
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label for="${id}" style="${LABEL}">${label}${required ? req : ''}</label>
                <select id="${id}" style="${INPUT}">
                    <option value="">Select</option>
                    ${options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
                </select>
                ${hint ? `<div style="${HELP}">${hint}</div>` : ''}
            </div>`;

        const dropzone = (id, label, required) => `
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label style="${LABEL}">${label}${required ? req : opt}</label>
                <div id="${id}-zone" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #a0b4c8;border-radius:8px;background:#f7fafc;cursor:pointer;">
                    <div style="width:32px;height:32px;border-radius:8px;background:#ebf8ff;color:#3182ce;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">↑</div>
                    <div style="flex:1;min-width:0;">
                        <div id="${id}-title" style="font-weight:600;font-size:13px;color:#2d3748;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Choose a file to upload</div>
                        <div style="font-size:11px;color:#718096;">PDF, JPG or PNG · up to ${MAX_FILE_MB} MB</div>
                    </div>
                    <span style="font-size:12px;color:#718096;">Browse</span>
                </div>
                <input type="file" id="${id}-input" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
            </div>`;

        // ---------- LAYOUT ----------
        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <a href="#" id="back-customers-link" style="color:#3182ce;text-decoration:none;">Customers</a> › <span style="color:#2d3748;font-weight:500;">New customer</span>
            </div>
            <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;color:#1a202c;">New customer</h1>

            <div style="${CARD}">
                <div style="${SECTION}margin-bottom:16px;">KRA VERIFICATION</div>
                <div style="margin-bottom:20px;">${dropzone('nc-kra', 'KRA PIN Certificate', true)}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;align-items:start;">
                    ${fld({ label: 'KRA PIN', id: 'nc-pin', required: true, placeholder: 'Auto-filled on certificate upload', readonly: true, hint: '<span id="nc-pin-err" style="color:#e53e3e;"></span>' })}
                    ${fld({ label: 'Registered Name (per KRA)', id: 'nc-regname', required: true, placeholder: 'Auto-filled on certificate upload', readonly: true })}
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="${LABEL}">PIN Status</label>
                        <div id="nc-pin-status" style="padding:6px 0;"><span style="color:#a0aec0;font-size:13px;">—</span></div>
                    </div>
                </div>
            </div>

            <div style="${CARD}">
                <div style="${SECTION}margin-bottom:16px;">CUSTOMER DETAILS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;align-items:start;">
                    ${fld({ label: 'Customer ID', id: 'nc-id', required: true, placeholder: 'Enter customer ID' })}
                    ${fld({ label: 'Customer Name', id: 'nc-name', required: true, placeholder: 'Enter customer name' })}
                    ${dropzone('nc-cr12', 'Business Registration / CR12', false)}
                </div>
            </div>

            <div style="${CARD}">
                <div style="${SECTION}margin-bottom:2px;">DELIVERY POINTS</div>
                <div style="${HELP}margin-bottom:14px;" id="nc-dp-help"></div>
                <div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                            <th style="${TH}width:60px;">No.</th>
                            <th style="${TH}">Delivery Point Name</th>
                            <th style="${TH}">Location / Address</th>
                            <th style="${TH}width:40px;"></th>
                        </tr></thead>
                        <tbody id="nc-dp-tbody"></tbody>
                    </table>
                </div>
                <button type="button" id="nc-dp-add" style="margin-top:14px;padding:6px 12px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;color:#3182ce;">+ Add row</button>
            </div>

            <div style="${CARD}">
                <div style="${SECTION}margin-bottom:2px;">CONTACT PERSONS</div>
                <div style="${HELP}margin-bottom:14px;">At least 1, at most 3. Exactly one must be marked Primary Contact.</div>
                <div style="border:1px solid #e2e8f0;border-radius:6px;overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:900px;">
                        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                            <th style="${TH}width:50px;">No.</th>
                            <th style="${TH}">Name</th>
                            <th style="${TH}">Role</th>
                            <th style="${TH}">Phone</th>
                            <th style="${TH}width:90px;text-align:center;">Same as WA</th>
                            <th style="${TH}">WhatsApp</th>
                            <th style="${TH}">Email</th>
                            <th style="${TH}width:70px;text-align:center;">Primary</th>
                            <th style="${TH}width:40px;"></th>
                        </tr></thead>
                        <tbody id="nc-ct-tbody"></tbody>
                    </table>
                </div>
                <button type="button" id="nc-ct-add" style="margin-top:14px;padding:6px 12px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;color:#3182ce;">+ Add row</button>
            </div>

            <div style="${CARD}">
                <div style="${SECTION}margin-bottom:16px;">COMMERCIAL TERMS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
                    ${selectFld({ label: 'Payment Terms', id: 'nc-terms', required: true, hint: 'Invoice due date = invoice date + payment terms.' })}
                    ${selectFld({ label: 'Offloading Borne By', id: 'nc-offload', required: true, options: [{ value: 'Holec', label: 'Holec' }, { value: 'Customer', label: 'Customer' }], hint: "Who pays the labour to unload at the customer's site." })}
                </div>
            </div>

            <div style="${CARD}">
                <div style="${SECTION}margin-bottom:16px;">QUALITY SPEC</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;">
                    ${fld({ label: 'Moisture Max (%)', id: 'nc-moist', required: true, type: 'number', value: '13.5', step: '0.1' })}
                    ${fld({ label: 'Foreign Matter Max (%)', id: 'nc-fm', required: true, type: 'number', value: '2.0', step: '0.1' })}
                    ${fld({ label: 'Aflatoxin Max (ppb)', id: 'nc-afla', required: true, type: 'number', value: '10', step: '1' })}
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="nc-save-btn" style="${BTN_PRIMARY}">Save as Draft</button>
                <button class="h-btn ghost" id="nc-cancel-btn" style="${BTN_GHOST}">Cancel</button>
            </div>
        `;

        // ---------- NAV ----------
        document.getElementById('back-customers-link').addEventListener('click', (e) => { e.preventDefault(); navigate('customers'); });
        document.getElementById('nc-cancel-btn').addEventListener('click', () => navigate('customers'));

        // ---------- PAYMENT TERMS ----------
        frappe.db.get_list('Payment Terms Template', { fields: ['name'], order_by: 'name asc', limit: 100 })
            .then(rows => {
                $('#nc-terms').append((rows || []).map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join(''));
            })
            .catch(() => showToast('Could not load Payment Terms', 'orange'));

        // ---------- FILE PICKER ----------
        function bindDropzone(id, onFile) {
            const zone = document.getElementById(`${id}-zone`);
            const input = document.getElementById(`${id}-input`);
            zone.addEventListener('click', () => input.click());
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) { showToast('Only PDF, JPG or PNG files are allowed.', 'red'); input.value = ''; return; }
                if (file.size > MAX_FILE_MB * 1024 * 1024) { showToast(`File must be ${MAX_FILE_MB} MB or less.`, 'red'); input.value = ''; return; }
                $(`#${id}-title`).text(file.name).css('color', '#276749');
                onFile(file);
            });
        }

        // ---------- PIN STATUS ----------
        function setPinStatus(status) {
            state.pinStatus = status;
            const map = {
                Verified: ['#f0fff4', '#276749', '#38a169'],
                Mismatch: ['#fff5f5', '#c53030', '#e53e3e'],
                Manual: ['#fffaf0', '#9c4221', '#dd6b20']
            };
            const [bg, color, dot] = map[status] || ['#edf2f7', '#4a5568', '#a0aec0'];
            $('#nc-pin-status').html(status
                ? `<span style="display:inline-flex;align-items:center;gap:6px;background:${bg};color:${color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:500;"><span style="width:6px;height:6px;background:${dot};border-radius:50%;"></span>${status}</span>`
                : '<span style="color:#a0aec0;font-size:13px;">—</span>');

            const locked = status !== 'Manual';
            $('#nc-pin, #nc-regname').prop('readonly', locked).css('background', locked ? '#f7fafc' : '#fff');
        }

        // ---------- PIN VALIDATION ----------
        async function validatePin(pin) {
            $('#nc-pin-err').text('');
            state.pinDuplicate = false;
            if (!pin) return false;
            if (!KRA_REGEX.test(pin)) {
                $('#nc-pin-err').text('Invalid KRA PIN. Format: A or P, 9 digits, 1 letter (e.g. A123456789Z).');
                return false;
            }
            try {
                const dup = await frappe.db.get_list('Customer', { filters: { tax_id: pin }, fields: ['name', 'customer_name'], limit: 1 });
                if (dup && dup.length) {
                    state.pinDuplicate = true;
                    $('#nc-pin-err').text(`This KRA PIN already exists on customer ${dup[0].customer_name || dup[0].name}.`);
                    return false;
                }
            } catch (e) { console.error('Duplicate PIN check failed', e); }
            return true;
        }

        // ---------- KRA CERTIFICATE -> OCR ----------
        function applyKraResult(r) {
            const pin = str(r.pin).toUpperCase();
            const regName = str(r.name);
            $('#nc-pin').val(pin);
            $('#nc-regname').val(regName);
            if (regName && !state.nameTouched) $('#nc-name').val(regName);

            const lowConfidence = !pin || !regName || flt(r.confidence) < OCR_MIN_CONFIDENCE || !KRA_REGEX.test(pin);
            let status = 'Manual';
            if (!lowConfidence && KRA_LOOKUP_ENABLED && r.lookup && r.lookup !== 'unavailable') {
                status = r.lookup === 'match' ? 'Verified' : 'Mismatch';
            }
            setPinStatus(status);
            validatePin(pin);
            if (status === 'Manual') showToast('Please confirm the KRA PIN and name manually. Finance will verify.', 'orange');
            else if (status === 'Mismatch') showToast('Name on certificate differs from KRA records. Finance will decide.', 'orange');
            else showToast(`KRA PIN ${pin} verified`);
        }

        bindDropzone('nc-kra', (file) => {
            state.kraFile = file;
            const reader = new FileReader();
            reader.onload = (ev) => {
                showToast('Reading KRA certificate...', 'orange');
                frappe.call({
                    method: 'holec_trading.holec_trading.page.holec_trading.holec_trading.extract_kra_details',
                    args: { filedata: ev.target.result, filename: file.name },
                    silent: true,
                    freeze: true,
                    freeze_message: 'Reading KRA certificate...',
                    callback: (r) => {
                        const m = r && r.message;
                        if (m && (m.pin || m.name)) {
                            applyKraResult(m);
                        } else {
                            setPinStatus('Manual');
                            showToast(`Could not read the certificate${m && m.error ? ': ' + m.error : ''}. Enter the PIN and name manually.`, 'orange');
                            console.error('KRA extract result:', m);
                        }
                    },
                    error: () => {
                        setPinStatus('Manual');
                        showToast('Certificate reading failed. Enter the PIN and name manually.', 'orange');
                    }
                });
            };
            reader.readAsDataURL(file);
        });

        bindDropzone('nc-cr12', (file) => { state.crFile = file; });

        $('#nc-name').on('input', () => { state.nameTouched = true; });
        $('#nc-pin').on('input', function () {
            this.value = this.value.toUpperCase().replace(/\s/g, '');
            validatePin(this.value);
        });

        // ---------- DELIVERY POINTS TABLE ----------
        function renderDeliveryPoints() {
            $('#nc-dp-help').text(MAX_DELIVERY_POINTS === 1 ? 'One delivery point only.' : `At least 1, at most ${MAX_DELIVERY_POINTS}.`);
            $('#nc-dp-add').toggle(MAX_DELIVERY_POINTS > 1);
            $('#nc-dp-tbody').html(state.deliveryPoints.map((d, i) => `
                <tr style="border-bottom:1px solid #edf2f7;">
                    <td style="padding:8px 12px;color:#4a5568;">${i + 1}</td>
                    <td style="padding:8px 12px;"><input class="dp" data-k="name" data-i="${i}" value="${esc(d.name)}" style="${CELL_INPUT}"></td>
                    <td style="padding:8px 12px;"><input class="dp" data-k="address" data-i="${i}" value="${esc(d.address)}" style="${CELL_INPUT}"></td>
                    <td style="padding:8px 12px;text-align:center;color:#a0aec0;cursor:pointer;" class="dp-del" data-i="${i}">${state.deliveryPoints.length > 1 ? '🗑' : ''}</td>
                </tr>`).join(''));
        }
        $('#nc-dp-tbody').on('input', '.dp', function () {
            state.deliveryPoints[this.dataset.i][this.dataset.k] = this.value;
        });
        $('#nc-dp-tbody').on('click', '.dp-del', function () {
            if (state.deliveryPoints.length > 1) { state.deliveryPoints.splice(this.dataset.i, 1); renderDeliveryPoints(); }
        });
        $('#nc-dp-add').on('click', () => {
            if (state.deliveryPoints.length >= MAX_DELIVERY_POINTS) return showToast(`Maximum ${MAX_DELIVERY_POINTS} delivery points allowed.`, 'orange');
            state.deliveryPoints.push({ name: '', address: '' });
            renderDeliveryPoints();
        });

        // ---------- CONTACT PERSONS TABLE ----------
        function renderContacts() {
            $('#nc-ct-tbody').html(state.contacts.map((c, i) => `
                <tr style="border-bottom:1px solid #edf2f7;">
                    <td style="padding:8px 12px;color:#4a5568;">${i + 1}</td>
                    <td style="padding:8px 12px;"><input class="ct" data-k="name" data-i="${i}" value="${esc(c.name)}" style="${CELL_INPUT}"></td>
                    <td style="padding:8px 12px;"><input class="ct" data-k="role" data-i="${i}" value="${esc(c.role)}" style="${CELL_INPUT}"></td>
                    <td style="padding:8px 12px;"><input class="ct" data-k="phone" data-i="${i}" value="${esc(c.phone)}" placeholder="07XX XXX XXX" style="${CELL_INPUT}"></td>
                    <td style="padding:8px 12px;text-align:center;"><input type="checkbox" class="ct-wa" data-i="${i}" ${c.same_as_wa ? 'checked' : ''}></td>
                    <td style="padding:8px 12px;">${c.same_as_wa
                        ? '<span style="color:#a0aec0;font-size:12px;">— same as phone</span>'
                        : `<input class="ct" data-k="whatsapp" data-i="${i}" value="${esc(c.whatsapp)}" style="${CELL_INPUT}">`}</td>
                    <td style="padding:8px 12px;"><input class="ct" data-k="email" data-i="${i}" value="${esc(c.email)}" style="${CELL_INPUT}"></td>
                    <td style="padding:8px 12px;text-align:center;"><input type="radio" name="nc-primary" class="ct-primary" data-i="${i}" ${c.is_primary ? 'checked' : ''}></td>
                    <td style="padding:8px 12px;text-align:center;color:#a0aec0;cursor:pointer;" class="ct-del" data-i="${i}">${state.contacts.length > 1 ? '🗑' : ''}</td>
                </tr>`).join(''));
        }
        $('#nc-ct-tbody').on('input', '.ct', function () { state.contacts[this.dataset.i][this.dataset.k] = this.value; });
        $('#nc-ct-tbody').on('change', '.ct-wa', function () {
            state.contacts[this.dataset.i].same_as_wa = this.checked;
            renderContacts();
        });
        $('#nc-ct-tbody').on('change', '.ct-primary', function () {
            state.contacts.forEach((c, i) => c.is_primary = (i == this.dataset.i));
        });
        $('#nc-ct-tbody').on('click', '.ct-del', function () {
            if (state.contacts.length > 1) {
                const wasPrimary = state.contacts[this.dataset.i].is_primary;
                state.contacts.splice(this.dataset.i, 1);
                if (wasPrimary) state.contacts[0].is_primary = true;
                renderContacts();
            }
        });
        $('#nc-ct-add').on('click', () => {
            if (state.contacts.length >= MAX_CONTACTS) return showToast(`Maximum ${MAX_CONTACTS} contact persons allowed.`, 'orange');
            state.contacts.push({ name: '', role: '', phone: '', same_as_wa: true, whatsapp: '', email: '', is_primary: false });
            renderContacts();
        });

        renderDeliveryPoints();
        renderContacts();
        setPinStatus(null);

        // ---------- HELPERS ----------
        const cleanPhone = (p) => String(p || '').replace(/[\s\-()]/g, '');
        const toIntl = (p) => {
            p = cleanPhone(p);
            if (p.startsWith('+254')) return p;
            if (p.startsWith('254')) return '+' + p;
            if (p.startsWith('0')) return '+254' + p.slice(1);
            return p;
        };

        // Frappe throws "dict can not be used as parameter" for object values; name the field instead
        function findObjectFields(doc) {
            const bad = [];
            Object.entries(doc).forEach(([k, v]) => {
                if (Array.isArray(v)) {
                    v.forEach((row, i) => Object.entries(row).forEach(([ck, cv]) => {
                        if (cv && typeof cv === 'object') bad.push(`${k}[${i + 1}].${ck}`);
                    }));
                } else if (v && typeof v === 'object') {
                    bad.push(k);
                }
            });
            return bad;
        }

        async function uploadToDoc(file, docname, fieldname) {
            const fd = new FormData();
            fd.append('file', file, file.name);
            fd.append('is_private', 1);
            fd.append('doctype', 'Customer');
            fd.append('docname', docname);
            fd.append('fieldname', fieldname);
            const res = await fetch('/api/method/upload_file', {
                method: 'POST',
                headers: { 'X-Frappe-CSRF-Token': frappe.csrf_token },
                body: fd
            });
            if (!res.ok) throw new Error('Upload failed: ' + file.name);
            return res.json();
        }

        // ---------- SAVE AS DRAFT ----------
        document.getElementById('nc-save-btn').addEventListener('click', async () => {
            const errors = [];
            const customerId = str($('#nc-id').val());
            const name = str($('#nc-name').val());
            const pin = str($('#nc-pin').val()).toUpperCase();
            const regName = str($('#nc-regname').val());
            const terms = str($('#nc-terms').val());
            const offload = str($('#nc-offload').val());
            const moist = str($('#nc-moist').val());
            const fm = str($('#nc-fm').val());
            const afla = str($('#nc-afla').val());

            // 1. KRA
            if (!state.kraFile) errors.push('KRA PIN Certificate is required.');
            if (!pin) errors.push('KRA PIN is required.');
            else if (!KRA_REGEX.test(pin)) errors.push('KRA PIN format is invalid (A or P, 9 digits, 1 letter).');
            else if (!(await validatePin(pin))) errors.push('This KRA PIN already exists on another customer.');
            if (!regName) errors.push('Registered Name (per KRA) is required.');

            // 2. Customer details
            if (!customerId) errors.push('Customer ID is required.');
            else {
                try {
                    const dupId = await frappe.db.get_list('Customer', { filters: { [CUSTOMER_ID_FIELD]: customerId }, fields: ['name'], limit: 1 });
                    if (dupId && dupId.length) errors.push(`Customer ID ${customerId} already exists.`);
                } catch (e) { console.warn('Customer ID duplicate check skipped (field missing?)', e); }
            }
            if (!name) errors.push('Customer Name is required.');

            // 3. Delivery points
            state.deliveryPoints.forEach((d, i) => {
                if (!str(d.name) || !str(d.address)) errors.push(`Delivery point ${i + 1}: name and location are required.`);
            });

            // 4. Contacts
            if (state.contacts.length < 1 || state.contacts.length > MAX_CONTACTS) errors.push(`Add between 1 and ${MAX_CONTACTS} contact persons.`);
            if (state.contacts.filter(c => c.is_primary).length !== 1) errors.push('Exactly one contact must be marked Primary.');
            state.contacts.forEach((c, i) => {
                const n = i + 1;
                if (!str(c.name)) errors.push(`Contact ${n}: Name is required.`);
                if (!str(c.phone)) errors.push(`Contact ${n}: Phone is required.`);
                else if (!PHONE_REGEX.test(cleanPhone(c.phone))) errors.push(`Contact ${n}: Phone must be a valid Kenyan number.`);
                if (!c.same_as_wa) {
                    if (!str(c.whatsapp)) errors.push(`Contact ${n}: WhatsApp number is required when "Same as WA" is unticked.`);
                    else if (!PHONE_REGEX.test(cleanPhone(c.whatsapp))) errors.push(`Contact ${n}: WhatsApp must be a valid Kenyan number.`);
                }
                if (str(c.email) && !EMAIL_REGEX.test(str(c.email))) errors.push(`Contact ${n}: Email format is invalid.`);
            });

            // 5. Commercial terms
            if (!terms) errors.push('Payment Terms is required.');
            if (!offload) errors.push('Offloading Borne By is required.');

            // 6. Quality spec
            [['Moisture Max', moist], ['Foreign Matter Max', fm], ['Aflatoxin Max', afla]].forEach(([l, v]) => {
                if (v === '' || isNaN(flt(v)) || flt(v) < 0) errors.push(`${l} is required and must be a valid number.`);
            });

            if (errors.length) {
                frappe.msgprint({ title: __('Please fix the following'), indicator: 'red', message: '<ul style="padding-left:18px;margin:0;">' + errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>' });
                return;
            }

            const payload = {
                doctype: 'Customer',
                customer_name: name,
                customer_type: 'Company',
                [CUSTOMER_ID_FIELD]: customerId,
                customer_group: DEFAULT_GROUP,
                territory: DEFAULT_TERRITORY,
                custom_vat_registered: 0,
                custom_kra_pin: pin,
                custom_registered_name_per_kra: regName,
                payment_terms: terms,
                custom_offloading_borne_by: offload,
                custom_moisture_max: flt(moist),
                custom_foreign_matter_max: flt(fm),
                custom_aflatoxin_max: flt(afla),
                custom_approval_status: 'Draft',
                disabled: 0,
                custom_holec_delivery_points: state.deliveryPoints.map(d => ({
                    delivery_point_name: str(d.name),
                    location: str(d.address)
                })),
                custom_holec_contacts: state.contacts.map(c => ({
                    contact_name: str(c.name),
                    role: str(c.role),
                    phone: toIntl(c.phone),
                    same_as_phone: c.same_as_wa ? 1 : 0,
                    whatsapp: toIntl(c.same_as_wa ? c.phone : c.whatsapp),
                    email: str(c.email),
                    is_primary: c.is_primary ? 1 : 0
                }))
            };

            const badFields = findObjectFields(payload);
            if (badFields.length) {
                console.error('Object values found in payload:', badFields, payload);
                frappe.msgprint({ title: __('Invalid value'), indicator: 'red', message: 'These fields contain an object instead of text/number: <b>' + badFields.map(esc).join(', ') + '</b>' });
                return;
            }

            const btn = $('#nc-save-btn').prop('disabled', true).text('Saving...');
            try {
                const doc = await frappe.db.insert(payload);

                if (doc) {
                    try {
                        if (state.kraFile) await uploadToDoc(state.kraFile, doc.name, 'custom_kra_certificate');
                        if (state.crFile) await uploadToDoc(state.crFile, doc.name, 'custom_business_registration');
                    } catch (upErr) {
                        console.error(upErr);
                        showToast('Customer saved, but a file upload failed. Re-attach it from the Customer record.', 'orange');
                    }
                    showToast(`Customer ${doc.name} saved as Draft. Awaiting Finance approval.`);
                    await loadMasterData();
                    navigate('customers');
                }
            } catch (err) {
                console.error('Error creating customer document:', err);
                showToast('Failed to create customer. Check Error Log / browser console.', 'red');
                btn.prop('disabled', false).text('Save as Draft');
            }
        });
    }

    // =====================================================================
    // NEW SUPPLIER
    // =====================================================================
    function renderNewSupplier(container) {
        const countyOptions = (LIVE_STORE?.countries || []).map(c => ({ value: c.name, label: c.country_name || c.name }));
        const areaOptions = (LIVE_STORE?.origin_area || []).map(d => ({ value: d.name, label: d.area_name || d.name }));
        const counOptions = (LIVE_STORE?.origin_county || []).map(a => ({ value: a.name, label: a.area_name || a.name }));
        const bankOptions = (LIVE_STORE?.banks || []).map(b => ({ value: b.name, label: b.bank_name ? `${b.bank_name} (${b.name})` : b.name }));
        const branchList = LIVE_STORE?.branch || [];
        const branchLabel = e => {
            const n = e.branch_name || e.bank_name;
            return n ? `${n} (${e.name})` : e.name;
        };
        const branchOptions = branchList.map(e => ({ value: e.name, label: branchLabel(e) }));

        let contactRows = [
            { name: '', role: '', phone: '', wa_same: true, whatsapp: '', email: '', is_primary: true }
        ];

        const CP_INPUT = 'width:100%;padding:6px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;';

        const renderContactsTable = () => {
            const tbody = document.getElementById('contacts-tbody');
            if (!tbody) return;

            tbody.innerHTML = contactRows.map((row, idx) => `
                <tr style="border-bottom:1px solid #edf2f7;">
                    <td style="padding:10px 12px;color:#4a5568;">${idx + 1}</td>
                    <td style="padding:10px 12px;"><input type="text" class="cp-name" data-idx="${idx}" value="${row.name}" style="${CP_INPUT}"></td>
                    <td style="padding:10px 12px;"><input type="text" class="cp-role" data-idx="${idx}" value="${row.role}" style="${CP_INPUT}"></td>
                    <td style="padding:10px 12px;"><input type="text" class="cp-phone" data-idx="${idx}" value="${row.phone}" style="${CP_INPUT}"></td>
                    <td style="padding:10px 12px;text-align:center;"><input type="checkbox" class="cp-same" data-idx="${idx}" ${row.wa_same ? 'checked' : ''}></td>
                    <td style="padding:10px 12px;"><input type="text" class="cp-wa" data-idx="${idx}" value="${row.wa_same ? row.phone : row.whatsapp}" ${row.wa_same ? 'disabled' : ''} style="${CP_INPUT}${row.wa_same ? 'background:#f7fafc;color:#a0aec0;' : ''}"></td>
                    <td style="padding:10px 12px;"><input type="text" class="cp-email" data-idx="${idx}" value="${row.email}" style="${CP_INPUT}"></td>
                    <td style="padding:10px 12px;text-align:center;"><input type="radio" name="primary-contact" class="cp-primary" data-idx="${idx}" ${row.is_primary ? 'checked' : ''}></td>
                    <td style="padding:10px 12px;text-align:center;color:#a0aec0;cursor:pointer;" class="delete-contact" data-idx="${idx}">${contactRows.length > 1 ? '🗑' : ''}</td>
                </tr>
            `).join('');

            tbody.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', (e) => {
                    const i = e.target.dataset.idx;
                    if (e.target.classList.contains('cp-name')) contactRows[i].name = e.target.value;
                    if (e.target.classList.contains('cp-role')) contactRows[i].role = e.target.value;
                    if (e.target.classList.contains('cp-phone')) {
                        contactRows[i].phone = e.target.value;
                        if (contactRows[i].wa_same) {
                            const wa = tbody.querySelector(`.cp-wa[data-idx="${i}"]`);
                            if (wa) wa.value = e.target.value;
                        }
                    }
                    if (e.target.classList.contains('cp-wa')) contactRows[i].whatsapp = e.target.value;
                    if (e.target.classList.contains('cp-email')) contactRows[i].email = e.target.value;
                });
            });

            tbody.querySelectorAll('.cp-same').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const i = e.target.dataset.idx;
                    contactRows[i].wa_same = e.target.checked;
                    if (!e.target.checked && !contactRows[i].whatsapp) {
                        contactRows[i].whatsapp = contactRows[i].phone;
                    }
                    renderContactsTable();
                });
            });

            tbody.querySelectorAll('.cp-primary').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    const i = e.target.dataset.idx;
                    contactRows.forEach((r, idx) => r.is_primary = (idx == i));
                });
            });

            tbody.querySelectorAll('.delete-contact').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const i = e.target.dataset.idx;
                    contactRows.splice(i, 1);
                    if (!contactRows.some(r => r.is_primary) && contactRows.length) contactRows[0].is_primary = true;
                    renderContactsTable();
                });
            });
        };

        const SEC = 'font-size:11px;font-weight:700;color:#a0aec0;letter-spacing:0.05em;';

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <a href="#" id="back-suppliers-link" style="color:#3182ce;text-decoration:none;">Suppliers</a> › <span style="color:#2d3748;font-weight:500;">New supplier</span>
            </div>

            <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;color:#1a202c;">New supplier</h1>

            <div style="${CARD_BOX}">
                <div style="${SEC}margin-bottom:16px;">BASIC DETAILS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;">
                    ${field({ label: 'Supplier Name *', id: 'ns-name', required: true })}
                    ${field({ label: 'Supplier Group *', id: 'ns-group', type: 'select', required: true, options: ['Farmer','Transporter','CESS'] })}
                    ${field({ label: 'Supplier Type *', id: 'ns-type', type: 'select', required: true, options: ['Company', 'Individual', 'Partnership'], value: 'Company' })}
                </div>
            </div>

            <div style="${CARD_BOX}">
                <div style="${SEC}margin-bottom:6px;">CONTACT PERSONS</div>
                <div style="font-size:12px;color:#718096;margin-bottom:16px;">At least 1, at most 3. Exactly one must be marked Primary Contact.</div>

                <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:10px 12px;width:50px;">No.</th>
                            <th style="padding:10px 12px;">Name</th>
                            <th style="padding:10px 12px;">Role</th>
                            <th style="padding:10px 12px;">Phone</th>
                            <th style="padding:10px 12px;width:80px;text-align:center;">Same as WA</th>
                            <th style="padding:10px 12px;">WhatsApp</th>
                            <th style="padding:10px 12px;">Email</th>
                            <th style="padding:10px 12px;width:60px;text-align:center;">Primary</th>
                            <th style="padding:10px 12px;width:50px;"></th>
                        </tr>
                    </thead>
                    <tbody id="contacts-tbody"></tbody>
                </table>
                <button type="button" class="h-btn sm" id="add-contact-row-btn" style="padding:6px 12px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;">Add row</button>
            </div>

            <div style="${CARD_BOX}">
                <div style="${SEC}margin-bottom:16px;">ADDITIONAL DETAILS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Country', id: 'ns-county', type: 'select', options: countyOptions })}
                    ${field({ label: 'Area', id: 'ns-area', type: 'select', options: areaOptions })}
                    ${field({ label: 'County', id: 'ns-coun', type: 'select', options: counOptions })}
                </div>
                ${field({ label: 'City', id: 'ns-city' })}
                ${field({ label: 'Physical Address', id: 'ns-address', type: 'textarea', span: true })}
            </div>

            <div style="${CARD_BOX}">
                <div style="${SEC}margin-bottom:16px;">COMPLIANCE</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="font-size:13px;font-weight:500;color:#4a5568;">KRA PIN Certificate</label>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <button type="button" id="upload-kra-btn" style="padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;cursor:pointer;width:fit-content;font-size:13px;color:#2d3748;">⬆ Upload</button>
                            <span id="kra-file-name" style="font-size:13px;color:#4a5568;font-style:italic;">No file chosen</span>
                        </div>
                    </div>
                    ${field({ label: 'KRA PIN *', id: 'ns-krapin', required: true, placeholder: 'Auto-filled on certificate upload' })}
                    ${field({ label: 'VAT Status', id: 'ns-vat', type: 'select', options: ['Registered', 'Exempt', 'Not Registered'] })}
                </div>
                <div style="max-width:320px;">
                    ${field({ label: 'eTIMS Registration Status', id: 'ns-etims', type: 'select', options: ['Registered', 'Pending', 'Not Required'] })}
                </div>
            </div>

            <div style="${CARD_BOX}margin-bottom:28px;">
                <div style="${SEC}margin-bottom:16px;">BANKING</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Bank *', id: 'ns-bank', type: 'select', required: true, options: bankOptions })}
                    ${field({ label: 'Bank Code *', id: 'ns-bank-code', required: true })}
                    ${field({ label: 'Swift Code *', id: 'ns-swift-code', required: true })}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Branch *', id: 'ns-branch', type: 'select', required: true, options: branchOptions })}
                    ${field({ label: 'Branch Code *', id: 'ns-branch-code', required: true })}
                    ${field({ label: 'Preferred Payment Rail', id: 'ns-rail', type: 'select', options: ['Pesalink', 'RTGS'] })}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Account Number *', id: 'ns-accno', required: true })}
                    ${field({ label: 'Account Name *', id: 'ns-accname', required: true, placeholder: 'Should closely match supplier name' })}
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="submit-draft-supplier-btn" style="${BTN_PRIMARY}">Submit as Draft</button>
                <button class="h-btn ghost" id="cancel-supplier-btn" style="${BTN_GHOST}">Cancel</button>
            </div>
        `;

        renderContactsTable();

        // Narrow the branch list to the selected bank (falls back to all branches if none match)
        $('#ns-bank').on('change', function () {
            const selectedBank = $(this).val();
            const branchSelect = $('#ns-branch');
            branchSelect.empty().append('<option value="">Select...</option>');

            let branches = branchList;
            if (selectedBank) {
                const matches = branchList.filter(b => b.bank === selectedBank);
                if (matches.length) branches = matches;
            }
            branches.forEach(b => {
                branchSelect.append(`<option value="${b.name}">${branchLabel(b)}</option>`);
            });
        });

        document.getElementById('upload-kra-btn').addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.pdf,.jpg,.jpeg,.png';
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function (uploadEvent) {
                        const base64Data = uploadEvent.target.result;
                        showToast('Extracting KRA PIN automatically...', 'orange');

                        frappe.call({
                            method: 'holec_trading.holec_trading.page.holec_trading.holec_trading.extract_kra_pin',
                            args: { filedata: base64Data, filename: file.name },
                            callback: function (r) {
                                if (r && r.message) {
                                    const extractedPin = r.message;
                                    $('#ns-krapin').val(extractedPin);
                                    $('#kra-file-name').text(file.name).css({ color: '#276749', 'font-style': 'normal', 'font-weight': '500' });
                                    showToast(`KRA PIN ${extractedPin} extracted and updated automatically`);
                                } else {
                                    showToast('Could not automatically parse KRA PIN. Please enter manually.', 'orange');
                                    $('#kra-file-name').text(file.name);
                                }
                            }
                        });
                    };
                    reader.readAsDataURL(file);
                }
            };
            fileInput.click();
        });

        document.getElementById('add-contact-row-btn').addEventListener('click', () => {
            if (contactRows.length < 3) {
                contactRows.push({ name: '', role: '', phone: '', wa_same: true, whatsapp: '', email: '', is_primary: false });
                renderContactsTable();
            } else {
                showToast('Maximum 3 contact persons allowed.', 'orange');
            }
        });

        document.getElementById('back-suppliers-link').addEventListener('click', (e) => { e.preventDefault(); navigate('suppliers'); });
        document.getElementById('cancel-supplier-btn').addEventListener('click', () => navigate('suppliers'));

        document.getElementById('submit-draft-supplier-btn').addEventListener('click', async () => {
            const supplierName = $('#ns-name').val();
            const supplierGroup = $('#ns-group').val();
            const supplierType = $('#ns-type').val();
            const taxId = $('#ns-krapin').val();
            const county = $('#ns-county').val();
            const city = $('#ns-city').val();
            const area = $('#ns-area').val();
            const address = $('#ns-address').val();
            const vatStatus = $('#ns-vat').val();
            const etimsStatus = $('#ns-etims').val();
            const bank = $('#ns-bank').val();
            const bankCode = $('#ns-bank-code').val();
            const branch = $('#ns-branch').val();
            const branchCode = $('#ns-branch-code').val();
            const swiftCode = $('#ns-swift-code').val();
            const accountNo = $('#ns-accno').val();
            const accountName = $('#ns-accname').val();

            if (!supplierName || !supplierGroup || !taxId || !bank || !bankCode || !branch || !branchCode || !swiftCode || !accountNo || !accountName) {
                frappe.msgprint(__('Please fill out all mandatory fields (Supplier Name, Group, KRA PIN, Bank, Bank Code, Branch, Branch Code, Swift Code, Account Number and Account Name).'));
                return;
            }

            // Sync the latest values from the DOM into contactRows
            const currentTbody = document.getElementById('contacts-tbody');
            if (currentTbody) {
                currentTbody.querySelectorAll('tr').forEach((tr, idx) => {
                    if (contactRows[idx]) {
                        const nameInput = tr.querySelector('.cp-name');
                        const roleInput = tr.querySelector('.cp-role');
                        const phoneInput = tr.querySelector('.cp-phone');
                        const emailInput = tr.querySelector('.cp-email');
                        const primaryRadio = tr.querySelector('.cp-primary');
                        const sameCb = tr.querySelector('.cp-same');
                        const waInput = tr.querySelector('.cp-wa');

                        if (nameInput) contactRows[idx].name = nameInput.value;
                        if (roleInput) contactRows[idx].role = roleInput.value;
                        if (phoneInput) contactRows[idx].phone = phoneInput.value;
                        if (emailInput) contactRows[idx].email = emailInput.value;
                        if (primaryRadio) contactRows[idx].is_primary = primaryRadio.checked;
                        if (sameCb) contactRows[idx].wa_same = sameCb.checked;
                        if (waInput && !waInput.disabled) contactRows[idx].whatsapp = waInput.value;
                    }
                });
            }

            const contactsToSave = contactRows.map(r => ({
                contact_name: r.name,
                role: r.role,
                phone: r.phone,
                same_as_phone: r.wa_same ? 1 : 0,
                whatsapp: r.wa_same ? r.phone : r.whatsapp,
                email: r.email,
                is_primary: r.is_primary ? 1 : 0
            })).filter(r => r.contact_name && r.contact_name.trim() !== '');

            try {
                const res = await frappe.db.insert({
                    doctype: 'Supplier',
                    supplier_name: supplierName,
                    supplier_group: supplierGroup,
                    supplier_type: supplierType,
                    country: county || 'Kenya',
                    city: city,
                    tax_id: taxId,
                    kra_pin: taxId,
                    area: area,
                    address_line1: address,
                    custom_vat_status: vatStatus,
                    custom_etims_status: etimsStatus,
                    bank: bank,
                    bank_code: bankCode,
                    bank_branch: branch,
                    branch_code: branchCode,
                    swift_code: swiftCode,
                    account_number: accountNo,
                    account_name: accountName,
                    holec_contacts: contactsToSave
                });

                if (res) {
                    showToast(`Supplier ${res.name} created as Draft successfully`);
                    await loadMasterData();
                    navigate('suppliers');
                }
            } catch (err) {
                console.error('Error creating supplier document:', err);
                showToast('Failed to create supplier document', 'red');
            }
        });
    }

    // =====================================================================
    // LOTS LIST + SHARED DETAIL VIEW
    // =====================================================================
    const lotCode = (l) => 'LOT-' + (l.name.replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase() || 'XXXXX');

    function renderLots(container, params) {
        if (params.id) {
            return renderLotDetail(container, params.id);
        }
        const stateFilter = container._filter || 'ALL';
        const lots = LIVE_STORE.lots.filter(l => stateFilter === 'ALL' || (l.status || 'Ticket') === stateFilter);

        const rows = lots.map(l => {
            const p = computePayable(l);
            const displayQty = (l.status || 'Ticket') === 'Ticket' ? (l.quantity_kg || 0) : p.acceptedNetKg;
            const origin = l.region || '—';

            return `
            <tr class="clickable" data-id="${l.name}" style="border-bottom:1px solid #edf2f7;cursor:pointer;transition:background 0.1s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding:14px 20px;font-family:monospace;font-weight:600;color:#2d3748;">${l.name}</td>
                <td style="padding:14px 16px;font-family:monospace;color:#718096;">${lotCode(l)}</td>
                <td style="padding:14px 16px;color:#2d3748;">${l.supplier || '—'}</td>
                <td style="padding:14px 16px;color:#718096;">${origin}</td>
                <td style="padding:14px 16px;text-align:right;color:#2d3748;font-weight:500;">${fmtKg(displayQty)}</td>
                <td style="padding:14px 20px;">${statusBadge(l.status || 'Ticket')}</td>
            </tr>`;
        }).join('');

        const stateCounts = STAGE_ORDER.reduce((acc, s) => {
            acc[s] = LIVE_STORE.lots.filter(l => (l.status || 'Ticket') === s).length;
            return acc;
        }, {});

        const filterBtn = (key, label) => `
            <button class="h-btn sm" data-filter="${key}" style="padding:6px 14px;border-radius:6px;border:1px solid #cbd5e0;background:${stateFilter === key ? '#1a202c' : '#fff'};color:${stateFilter === key ? '#fff' : '#4a5568'};cursor:pointer;font-size:13px;font-weight:500;">${label}</button>`;

        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h1 style="margin:0;font-size:22px;font-weight:700;color:#1a202c;display:flex;align-items:center;gap:10px;">Lots <span style="background:#edf2f7;color:#4a5568;font-size:12px;padding:2px 8px;border-radius:10px;font-weight:600;">${LIVE_STORE.lots.length}</span></h1>
                <button class="h-btn primary" id="new-ticket-btn" style="background:#1a202c;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">+ New Ticket</button>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center;">
                ${filterBtn('ALL', 'All')}
                ${STAGE_ORDER.map(s => filterBtn(s, `${s} (${stateCounts[s] || 0})`)).join('')}
            </div>
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:12px 20px;">Ticket</th>
                            <th style="padding:12px 16px;">Lot ID</th>
                            <th style="padding:12px 16px;">Supplier</th>
                            <th style="padding:12px 16px;">Origin</th>
                            <th style="padding:12px 16px;text-align:right;">Quantity</th>
                            <th style="padding:12px 20px;">State</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || `<tr><td colspan="6" style="padding:30px;text-align:center;color:#718096;">No lots found in this status.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;

        container.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => { container._filter = btn.dataset.filter; renderLots(container, params); });
        });
        container.querySelectorAll('tbody tr[data-id]').forEach(tr => {
            tr.addEventListener('click', () => navigate('lots', { id: tr.dataset.id }));
        });
        const newTicketBtn = document.getElementById('new-ticket-btn');
        if (newTicketBtn) newTicketBtn.addEventListener('click', () => navigate('tickets'));
    }

    // One detail screen for every stage (Ticket, Intake, Lot, Position, Invoiced, Settled)
    function renderLotDetail(container, id) {
        const l = LIVE_STORE.lots.find(x => x.name === id);
        if (!l) return navigate('lots');
        const status = l.status || 'Ticket';
        const p = computePayable(l);
        const m = computeMargin(l);
        const modifiedTime = frappe.datetime.str_to_user(l.modified || l.creation);
        const isTicket = status === 'Ticket';
        const showMargin = ['Invoiced', 'Settled'].includes(status);
        const customerKnown = ['Invoiced', 'Settled'].includes(status);
        const hasInvoice = ['Invoiced', 'Settled'].includes(status) && !!l.invoice_number;

        const PASSED = { Ticket: 0, Intake: 1, Lot: 2, Position: 3, Invoiced: 4, Settled: 5 };
        const passed = PASSED[status] != null ? PASSED[status] : 2;

        const events = {
            Intake: [['Lot lifecycle seeded to INTAKE', 'Weighbridge capture and quality inspection completed successfully.']],
            Lot: [['Lot created, net invoice posted', `Invoiced to ${l.supplier || '—'}`]],
            Position: [['Transport capitalised, moved to Position', `Haulage KES ${flt(l.haulage_kes)}, cess KES ${flt(l.cess_kes)}, offloading KES ${flt(l.offloading_kes)}`]],
            Invoiced: [['Lot lifecycle seeded to INVOICED', `Sales invoice ${l.invoice_number || ''} transmitted via eTIMS.`]],
            Settled: [
                ['Payment received, lot settled', `${fmtKES(m.revenue)} received from ${l.customer || '—'}. Margin per tonne: ${fmtKES(m.marginPerTonne)}`],
                ['Lot lifecycle seeded to INVOICED', `Sales invoice ${l.invoice_number || ''} transmitted via eTIMS.`]
            ]
        }[status] || [];

        const actions = {
            Ticket: { label: 'Continue to Intake →', run: () => navigate('intake', { id: l.name }) },
            Intake: {
                label: 'Continue to Lot →', run: async () => {
                    await frappe.db.set_value('Buy Ticket', l.name, { status: 'Lot' });
                    showToast(`Moved ${l.name} to Lot status`);
                    await loadMasterData();
                    navigate('lots', { id: l.name });
                }
            },
            Lot: { label: 'Continue to Position →', run: () => navigate('transport', { id: l.name }) },
            Position: { label: 'Continue to Sale & Invoicing →', run: () => navigate('sale_invoicing', { id: l.name }) },
            Invoiced: { label: 'Continue to Settled →', run: () => navigate('payments', { id: l.name }) }
        }[status];

        const dash = '—';
        const stat = (label, value, muted) => `
            <div>
                <span style="display:block;font-size:12px;color:#718096;margin-bottom:4px;">${label}</span>
                ${muted ? `<span style="font-size:14px;color:#718096;">${value}</span>` : `<strong style="font-size:14px;color:#2d3748;">${value}</strong>`}
            </div>`;
        const costRow = (label, value, border, extra) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;${border ? 'border-bottom:1px solid #edf2f7;' : ''}font-size:14px;${extra || ''}">
                <span style="color:#4a5568;">${label}</span><strong style="color:#2d3748;">${value}</strong>
            </div>`;

        const tracker = STAGE_ORDER.map((s, i) => {
            const isPassed = i < passed;
            const isCurrent = s === status;
            const bg = isCurrent ? '#1a202c' : (isPassed ? '#38a169' : '#edf2f7');
            const color = (isCurrent || isPassed) ? '#fff' : '#718096';
            return `
                <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:${isCurrent ? '#1a202c' : '#a0aec0'};font-weight:${isCurrent ? '600' : '400'};">
                    <span style="width:24px;height:24px;border-radius:50%;background:${bg};color:${color};display:inline-flex;align-items:center;justify-content:center;font-size:12px;">${isPassed ? '✓' : i + 1}</span>
                    <span>${s}</span>
                </div>
                ${i < STAGE_ORDER.length - 1 ? '<span style="color:#cbd5e0;margin:0 4px;">›</span>' : ''}`;
        }).join('');

        const eventsHtml = events.length ? events.map(ev => `
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <strong style="font-size:14px;color:#2d3748;display:block;margin-bottom:2px;">${ev[0]}</strong>
                    <span style="font-size:13px;color:#718096;">${ev[1]}</span>
                </div>
                <div style="text-align:right;font-size:12px;color:#a0aec0;">
                    <div>${frappe.session.user_fullname || frappe.session.user}</div>
                    <div>${modifiedTime}</div>
                </div>
            </div>`).join('')
            : `<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:30px;text-align:center;color:#718096;font-size:13px;">No events logged for this lot.</div>`;

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Trade</span> › <a href="#" id="back-link" style="color:#3182ce;text-decoration:none;">Lots</a>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
                <div>
                    <h1 style="margin:0 0 4px 0;font-size:22px;color:#1a202c;font-weight:700;">${l.name} · ${lotCode(l)}</h1>
                    <span style="color:#718096;font-size:13px;">${l.supplier || '—'} · ${isTicket ? 'origin not yet captured' : (l.region || 'origin not captured')}</span>
                </div>
                ${statusBadge(status)}
            </div>

            <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;">${tracker}</div>

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">OVERVIEW</div>
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px;">
                ${stat('Supplier', l.supplier || dash)}
                ${customerKnown ? stat('Customer', l.customer || dash) : stat('Customer', l.customer || 'Not yet matched', true)}
                ${stat('Gross weight', isTicket ? dash : fmtKg(l.gross_weight_kg || 0))}
                ${stat('Accepted (stock) qty', isTicket ? dash : fmtKg(p.acceptedNetKg))}
                ${stat('Moisture', (!isTicket && l.moisture_) ? l.moisture_ + '%' : dash)}
                ${stat('Aflatoxin', (!isTicket && l.aflatoxin_ppb) ? l.aflatoxin_ppb + ' ppb' : dash)}
            </div>

            ${isTicket ? '' : `
            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">COST SUMMARY</div>
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 20px;margin-bottom:24px;">
                ${costRow('Net Payable to Supplier', fmtKES(p.netPayable), true)}
                ${costRow('Transport & handling', fmtKES(p.totalTransport), true)}
                ${costRow('Landed cost per kg', p.landedCostPerKg + ' /kg', showMargin, 'font-weight:700;')}
                ${showMargin ? costRow('Revenue (customer net × sell rate)', fmtKES(m.revenue), true) : ''}
                ${showMargin ? costRow('Margin', fmtKES(m.margin), true) : ''}
                ${showMargin ? costRow('Margin per tonne', fmtKES(m.marginPerTonne), false) : ''}
            </div>`}

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">TRADE EVENT LOG</div>
            <div style="margin-bottom:12px;">${eventsHtml}</div>

            <div style="display:flex;gap:12px;align-items:center;">
                ${hasInvoice ? `<button class="h-btn" id="download-invoice-template-btn" style="${BTN_OUTLINE}">↓ Invoice Template</button>` : ''}
                ${actions ? `<button class="h-btn primary" id="advance-btn" style="${BTN_PRIMARY}">${actions.label}</button>` : ''}
                <button class="h-btn ghost" id="back-to-lots-btn" style="${BTN_GHOST}">Back to lots</button>
            </div>
        `;

        document.getElementById('back-link').addEventListener('click', (e) => { e.preventDefault(); navigate('lots'); });
        document.getElementById('back-to-lots-btn').addEventListener('click', () => navigate('lots'));
        if (actions) document.getElementById('advance-btn').addEventListener('click', actions.run);

        const invoiceBtn = document.getElementById('download-invoice-template-btn');
        if (invoiceBtn) {
            invoiceBtn.addEventListener('click', async () => {
                const original = invoiceBtn.textContent;
                invoiceBtn.disabled = true;
                invoiceBtn.textContent = 'Preparing...';
                try { await printInvoiceTemplate(l); }
                finally {
                    invoiceBtn.disabled = false;
                    invoiceBtn.textContent = original;
                }
            });
        }
    }

    // =====================================================================
    // PAYMENTS (customer receipt)
    // =====================================================================
    async function getModeOfPaymentAccount(modeOfPayment, company) {
        try {
            const mop = await frappe.db.get_doc('Mode of Payment', modeOfPayment);
            const acc = (mop.accounts || []).find(a => a.company === company);
            return acc ? acc.default_account : null;
        } catch (e) {
            console.error('Error fetching Mode of Payment account:', e);
            return null;
        }
    }

    async function submitFrappeDoc(doc) {
        return frappe.call({ method: 'frappe.client.submit', args: { doc: doc } });
    }

    async function renderPayments(container, params) {
        const l = LIVE_STORE.lots.find(x => x.name === params.id) || LIVE_STORE.lots[0];
        if (!l) return navigate('lots');
        const m = computeMargin(l);
        const amountDue = Math.round(m.revenue);

        // Only Bank-type Mode of Payment records (customer bank receipt)
        let modeOfPayments = ['Bank Draft', 'Wire Transfer', 'RTGS', 'Pesalink'];
        try {
            const mopList = await frappe.db.get_list('Mode of Payment', {
                filters: { type: 'Bank' },
                fields: ['name'],
                order_by: 'name asc'
            });
            if (mopList && mopList.length > 0) modeOfPayments = mopList.map(x => x.name);
        } catch (e) {
            console.error('Error fetching Mode of Payment:', e);
        }

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Finance</span> › <span style="color:#2d3748;font-weight:500;">Payments</span>
            </div>

            <div style="margin-bottom:20px;">
                <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#1a202c;">Record customer payment</h1>
                <span style="font-size:13px;color:#718096;">${l.name} · ${l.customer || '—'} · ${l.invoice_number || '—'}</span>
            </div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Customer Payment</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="font-size:13px;font-weight:500;color:#4a5568;">Amount Due</label>
                        <div style="padding:8px 12px;background:#f7fafc;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;color:#2d3748;font-weight:600;">KES ${amountDue.toLocaleString('en-KE')}</div>
                    </div>
                    ${field({ label: 'Mode of Payment', id: 'f-payment-rail', type: 'select', value: modeOfPayments.includes('Bank Draft') ? 'Bank Draft' : (modeOfPayments[0] || ''), options: modeOfPayments })}
                </div>
            </div>

            <div style="${CARD_BOX}margin-bottom:28px;">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Bank reconciliation</h3>
                <div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;font-size:13px;color:#4a5568;display:flex;align-items:center;gap:12px;">
                    <span>ℹ</span>
                    <span>On confirmation, this receipt is matched to ${l.invoice_number || 'the sales invoice'} and the lot moves to Settled.</span>
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="confirm-settle-btn" style="${BTN_PRIMARY}">Confirm receipt & settle lot</button>
                <button class="h-btn ghost" id="cancel-payment-btn" style="${BTN_GHOST}">Cancel</button>
            </div>
        `;

        document.getElementById('cancel-payment-btn').addEventListener('click', () => navigate('lots', { id: l.name }));

        document.getElementById('confirm-settle-btn').addEventListener('click', async () => {
            const rail = $('#f-payment-rail').val();

            if (!rail) {
                frappe.msgprint(__('Please select a payment rail.'));
                return;
            }

            try {
                // 1. Submit the Sales Invoice first (if still draft)
                let siDoc = null;
                if (l.invoice_number) {
                    siDoc = await frappe.db.get_doc('Sales Invoice', l.invoice_number);
                    if (siDoc.docstatus === 0) {
                        await submitFrappeDoc(siDoc);
                        siDoc = await frappe.db.get_doc('Sales Invoice', l.invoice_number);
                    }
                }

                if (!siDoc) {
                    frappe.msgprint(__('No Sales Invoice found for this ticket. Cannot record payment.'));
                    return;
                }

                // 2. Account the money lands in (from the Mode of Payment)
                const paidTo = await getModeOfPaymentAccount(rail, COMPANY);
                if (!paidTo) {
                    frappe.msgprint(__('Could not determine the Paid To account. Check that "{0}" has a default account set for {1}.', [rail, COMPANY]));
                    return;
                }

                // 3. Let ERPNext build a fully populated Payment Entry from the Sales Invoice
                const res = await frappe.call({
                    method: 'erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry',
                    args: { dt: 'Sales Invoice', dn: siDoc.name }
                });
                const peDoc = res.message;
                if (!peDoc) {
                    frappe.msgprint(__('Could not build a Payment Entry from Sales Invoice {0}.', [siDoc.name]));
                    return;
                }

                // 4. Currency safety check
                const paidToCurrency = (await frappe.db.get_value('Account', paidTo, 'account_currency')).message.account_currency;
                if (paidToCurrency !== peDoc.paid_from_account_currency) {
                    frappe.msgprint(__('Currency mismatch: the invoice account is in {0} but the "{1}" account is in {2}.', [peDoc.paid_from_account_currency, rail, paidToCurrency]));
                    return;
                }

                // 5. Reference No / Date (mandatory for bank accounts)
                const refNo = ($('#f-payment-ref').val() || '').trim() || siDoc.name;
                const refDate = $('#f-payment-date').val() || frappe.datetime.get_today();

                Object.assign(peDoc, {
                    posting_date: frappe.datetime.get_today(),
                    mode_of_payment: rail,
                    paid_to: paidTo,
                    paid_to_account_currency: paidToCurrency,
                    target_exchange_rate: 1,
                    received_amount: peDoc.paid_amount,
                    reference_no: refNo,
                    reference_date: refDate,
                    custom_buy_ticket: l.name,
                    remarks: `Payment received via ${rail} for Sales Invoice ${siDoc.name} (Buy Ticket ${l.name}). Ref: ${refNo}`
                });

                // 6. Save as draft, then submit so it reconciles against the invoice
                const pe = await frappe.db.insert(peDoc);
                await submitFrappeDoc(pe);
            } catch (err) {
                console.error('Error submitting invoice or creating payment entry:', err);
                frappe.msgprint(__('Failed to record payment: ') + (err.message || err));
                return;
            }

            await frappe.db.set_value('Buy Ticket', l.name, { status: 'Settled' });
            showToast(`Payment received via ${rail} and lot settled`);
            await loadMasterData();
            navigate('lots', { id: l.name });
        });
    }

    // =====================================================================
    // COST LEDGER
    // =====================================================================
    function renderCostLedger(container) {
        const settledLots = LIVE_STORE.lots.filter(l => (l.status || 'Ticket') === 'Settled');

        let totalRealisedMargin = 0;
        let totalTonnes = 0;
        settledLots.forEach(l => {
            const m = computeMargin(l);
            totalRealisedMargin += m.margin;
            totalTonnes += m.soldKg / 1000;
        });
        const avgMarginPerTonne = totalTonnes > 0 ? Math.round(totalRealisedMargin / totalTonnes) : 0;

        const buyRows = LIVE_STORE.lots.map(l => {
            const p = computePayable(l);
            return `
                <tr style="border-bottom:1px solid #edf2f7;cursor:pointer;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" onclick="navigate('lots', { id: '${l.name}' })">
                    <td style="padding:12px 16px;font-family:monospace;font-weight:600;color:#2d3748;">${l.name}</td>
                    <td style="padding:12px 16px;color:#2d3748;">${l.supplier || '—'}</td>
                    <td style="padding:12px 16px;color:#2d3748;">${fmtKES(p.netPayable)}</td>
                    <td style="padding:12px 16px;color:#2d3748;">${fmtKES(p.totalTransport)}</td>
                    <td style="padding:12px 16px;color:#2d3748;">${p.landedCostPerKg} /kg</td>
                    <td style="padding:12px 16px;">${statusBadge(l.status || 'Ticket')}</td>
                </tr>`;
        }).join('');

        const soldOrInvoicedLots = LIVE_STORE.lots.filter(l => ['Invoiced', 'Settled'].includes(l.status));
        const sellRows = soldOrInvoicedLots.map(l => {
            const m = computeMargin(l);
            return `
                <tr style="border-bottom:1px solid #edf2f7;cursor:pointer;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" onclick="navigate('lots', { id: '${l.name}' })">
                    <td style="padding:12px 16px;font-family:monospace;font-weight:600;color:#2d3748;">${l.name}</td>
                    <td style="padding:12px 16px;color:#2d3748;">${l.customer || '—'}</td>
                    <td style="padding:12px 16px;color:#2d3748;">KES ${m.sellRate}/kg</td>
                    <td style="padding:12px 16px;color:#2d3748;">${fmtKES(m.revenue)}</td>
                    <td style="padding:12px 16px;color:#2d3748;">${fmtKES(m.marginPerTonne)}</td>
                    <td style="padding:12px 16px;">${statusBadge(l.status)}</td>
                </tr>`;
        }).join('');

        const th = (t) => `<th style="padding:12px 16px;">${t}</th>`;
        const kpi = (label, value) => `
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;">
                <span style="display:block;font-size:12px;color:#718096;margin-bottom:4px;">${label}</span>
                <strong style="font-size:24px;color:#1a202c;font-weight:700;">${value}</strong>
            </div>`;
        const table = (heads, body, empty) => `
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">${heads.map(th).join('')}</tr></thead>
                    <tbody>${body || `<tr><td colspan="${heads.length}" style="padding:20px;text-align:center;color:#718096;">${empty}</td></tr>`}</tbody>
                </table>
            </div>`;

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Insight</span> › <span style="color:#2d3748;font-weight:500;">Cost Ledger & Margin</span>
            </div>

            <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;color:#1a202c;">Cost Ledger & Margin</h1>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:24px;">
                ${kpi('Settled trades', settledLots.length)}
                ${kpi('Total realised margin', fmtKES(totalRealisedMargin))}
                ${kpi('Average margin / tonne', fmtKES(avgMarginPerTonne))}
            </div>

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">BUY — SUPPLIER COST</div>
            ${table(['Ticket', 'Supplier', 'Net Payable', 'Transport', 'Landed/kg', 'State'], buyRows, 'No supplier data found.')}

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">SELL — CUSTOMER REVENUE</div>
            ${table(['Ticket', 'Customer', 'Sell rate', 'Revenue', 'Margin/tonne', 'State'], sellRows, 'No customer revenue data found.')}
        `;
    }

    // =====================================================================
    // REPORTS
    // =====================================================================
    function renderReports(container) {
        const stateCounts = STAGE_ORDER.reduce((acc, s) => {
            acc[s] = LIVE_STORE.lots.filter(l => (l.status || 'Ticket') === s).length;
            return acc;
        }, {});

        let totalNetPayable = 0;
        LIVE_STORE.lots.forEach(l => { totalNetPayable += computePayable(l).netPayable; });

        // TODO: replace with a real query of submitted Payment Entries to suppliers
        const totalAlreadyPaid = 0;
        const outstandingPayable = Math.max(0, totalNetPayable - totalAlreadyPaid);

        const invoicedLots = LIVE_STORE.lots.filter(l => l.status === 'Invoiced');
        const receivablesDue = invoicedLots.reduce((acc, l) => acc + computeMargin(l).revenue, 0);

        const stockLots = LIVE_STORE.lots.filter(l => ['Lot', 'Position'].includes(l.status));
        const stockRows = stockLots.map(l => {
            const p = computePayable(l);
            const qty = flt(l.delivered_quantity_kg || p.acceptedNetKg || 0);
            return `
                <tr style="border-bottom:1px solid #edf2f7;cursor:pointer;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" onclick="navigate('lots', { id: '${l.name}' })">
                    <td style="padding:12px 16px;font-family:monospace;font-weight:600;color:#2d3748;">${l.name}</td>
                    <td style="padding:12px 16px;color:#2d3748;">${l.region || '—'}</td>
                    <td style="padding:12px 16px;color:#2d3748;font-weight:500;">${fmtKg(qty)}</td>
                    <td style="padding:12px 16px;">${statusBadge(l.status)}</td>
                </tr>`;
        }).join('');

        const cessMap = {};
        let totalCessSum = 0;
        LIVE_STORE.lots.forEach(l => {
            const cty = l.county || 'Unassigned';
            const cAmt = flt(l.cess_kes || 0);
            if (!cessMap[cty]) cessMap[cty] = 0;
            cessMap[cty] += cAmt;
            totalCessSum += cAmt;
        });

        const cessRows = Object.keys(cessMap).map(cty => `
            <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #edf2f7;font-size:14px;max-width:400px;">
                <span style="color:#2d3748;font-weight:500;">${cty}</span>
                <strong style="color:#2d3748;">KES ${cessMap[cty].toLocaleString('en-KE')}</strong>
            </div>`).join('');

        const cessBars = Object.keys(cessMap).map(cty => {
            const pct = totalCessSum > 0 ? Math.max(20, Math.round((cessMap[cty] / totalCessSum) * 180)) : 20;
            return `
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:${pct}px;height:24px;background:#1a202c;border-radius:4px;"></div>
                    <span style="font-size:11px;color:#718096;">${cty}</span>
                </div>`;
        }).join('');

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Insight</span> › <span style="color:#2d3748;font-weight:500;">Reports</span>
            </div>

            <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;color:#1a202c;">Reports</h1>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Open Lots By State</h3>
                <div style="display:flex;gap:24px;align-items:flex-end;">
                    ${STAGE_ORDER.map(s => `
                        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                            <strong style="font-size:16px;color:#1a202c;">${stateCounts[s] || 0}</strong>
                            <div style="width:36px;height:${Math.max(6, (stateCounts[s] || 0) * 30)}px;background:#1a202c;border-radius:4px 4px 0 0;"></div>
                            <span style="font-size:12px;color:#718096;">${s}</span>
                        </div>`).join('')}
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
                <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
                    <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Payables Due</h3>
                    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf2f7;font-size:14px;">
                        <span style="color:#4a5568;">Total Net Payable</span>
                        <strong style="color:#2d3748;">${fmtKES(totalNetPayable)}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf2f7;font-size:14px;">
                        <span style="color:#4a5568;">Already Paid</span>
                        <strong style="color:#e53e3e;">- ${fmtKES(totalAlreadyPaid)}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:12px 0 0 0;font-size:15px;font-weight:700;">
                        <span style="color:#1a202c;">Outstanding</span>
                        <span style="color:#1a202c;">${fmtKES(outstandingPayable)}</span>
                    </div>
                </div>

                <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
                    <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Receivables Due</h3>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;font-size:14px;">
                        <div>
                            <strong style="display:block;color:#2d3748;margin-bottom:2px;">Invoiced, Awaiting Payment</strong>
                            <span style="font-size:12px;color:#718096;">${invoicedLots.length} invoice(s)</span>
                        </div>
                        <strong style="font-size:16px;color:#1a202c;">${fmtKES(receivablesDue)}</strong>
                    </div>
                </div>
            </div>

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">STOCK ON HAND BY LOT</div>
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:12px 16px;">Ticket</th>
                            <th style="padding:12px 16px;">Location</th>
                            <th style="padding:12px 16px;">Quantity</th>
                            <th style="padding:12px 16px;">State</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stockRows || `<tr><td colspan="4" style="padding:20px;text-align:center;color:#718096;">No stock on hand.</td></tr>`}
                    </tbody>
                </table>
            </div>

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">CESS BY COUNTY</div>
            <div style="${CARD_BOX}display:flex;justify-content:space-between;align-items:center;">
                <div style="flex-grow:1;">${cessRows || '<span style="color:#718096;font-size:13px;">No cess recorded.</span>'}</div>
                <div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start;">${cessBars}</div>
            </div>
        `;
    }

    // =====================================================================
    // TRADE EVENT LOG
    // =====================================================================
    function renderTradeEventLog(container) {
        const searchTerm = container._searchQuery || '';
        const logs = LIVE_STORE.lotEventLogs || [];

        const filteredLogs = logs.filter(e => {
            const lotName = (e.lot || '').toLowerCase();
            const logId = (e.name || '').toLowerCase();
            const query = searchTerm.toLowerCase();
            return lotName.includes(query) || logId.includes(query);
        });

        const rows = filteredLogs.map(e => {
            const idVal = e.name;
            return `
                <tr style="border-bottom:1px solid #edf2f7;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding:14px 16px;"><span style="color:#3182ce;font-weight:500;">${idVal}</span></td>
                    <td style="padding:14px 16px;font-family:monospace;color:#2d3748;">${e.lot || '—'}</td>
                    <td style="padding:14px 16px;color:#2d3748;">${e.state || '—'}</td>
                    <td style="padding:14px 16px;color:#4a5568;">${e.owner || '—'}</td>
                    <td style="padding:14px 16px;color:#718096;">${e.modified || e.creation || '—'}</td>
                    <td style="padding:14px 16px;text-align:right;">
                        <a href="/app/lot-event-log/${idVal}" target="_blank" class="h-btn sm" style="padding:4px 10px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;text-decoration:none;color:#2d3748;font-size:12px;font-weight:500;">Open ↗</a>
                    </td>
                </tr>`;
        }).join('');

        container.innerHTML = `
            <div style="margin-bottom:20px;">
                <h1 style="margin:0;font-size:22px;font-weight:700;color:#1a202c;">Lot Event Log</h1>
            </div>

            <div style="display:flex;align-items:center;margin-bottom:16px;background:#ffffff;padding:10px 14px;border:1px solid #e2e8f0;border-radius:6px;">
                <input type="text" id="log-search-input" value="${searchTerm}" placeholder="Search Lot or ID" style="border:1px solid #cbd5e0;border-radius:4px;padding:4px 8px;font-size:13px;width:220px;">
            </div>

            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:12px 16px;">ID</th>
                            <th style="padding:12px 16px;">Lot</th>
                            <th style="padding:12px 16px;">State</th>
                            <th style="padding:12px 16px;">Changed By</th>
                            <th style="padding:12px 16px;">Changed At</th>
                            <th style="padding:12px 16px;text-align:right;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || `<tr><td colspan="6" style="padding:30px;text-align:center;color:#718096;">No event logs found.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;

        const searchInput = document.getElementById('log-search-input');
        searchInput.addEventListener('input', (e) => {
            container._searchQuery = e.target.value;
            renderTradeEventLog(container);
            const updatedInput = document.getElementById('log-search-input');
            updatedInput.focus();
            updatedInput.setSelectionRange(updatedInput.value.length, updatedInput.value.length);
        });
    }

    // =====================================================================
    // PAYMENTS LIST + PAY TRANSPORTER
    // =====================================================================
    async function renderPaymentsList(container) {
        let paymentEntries = [];
        let transportTickets = [];

        try {
            [paymentEntries, transportTickets] = await Promise.all([
                frappe.db.get_list('Payment Entry', {
                    fields: ['name', 'party', 'party_type', 'paid_amount', 'mode_of_payment', 'docstatus', 'creation'],
                    order_by: 'creation desc',
                    limit: 50
                }),
                frappe.db.get_list('Buy Ticket', {
                    filters: [
                        ['transporter', 'is', 'set'],
                        ['transport_paid', '=', 0],
                        ['status', 'in', ['Position', 'Invoiced', 'Settled']]
                    ],
                    fields: ['name', 'transporter', 'haulage_kes', 'cess_kes', 'status'],
                    order_by: 'creation desc',
                    limit: 100
                })
            ]);
        } catch (e) {
            console.error('Error fetching payment data:', e);
        }

        const dueTickets = (transportTickets || []).filter(t => flt(t.haulage_kes) > 0 || flt(t.cess_kes) > 0);

        const transporterRows = dueTickets.map(t => `
            <tr style="border-bottom:1px solid #edf2f7;">
                <td style="padding:12px 16px;font-family:monospace;font-weight:600;color:#2d3748;">${t.name}</td>
                <td style="padding:12px 16px;color:#2d3748;">${t.transporter}</td>
                <td style="padding:12px 16px;color:#2d3748;">${fmtKES(t.haulage_kes)}</td>
                <td style="padding:12px 16px;color:#2d3748;">${fmtKES(t.cess_kes)}</td>
                <td style="padding:12px 16px;text-align:right;">
                    <button class="h-btn sm primary pay-transporter-btn" data-id="${t.name}" style="background:#1a202c;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-weight:600;cursor:pointer;font-size:12px;">Pay Transporter</button>
                </td>
            </tr>`).join('');

        const historyRows = (paymentEntries || []).map(pe => `
            <tr style="border-bottom:1px solid #edf2f7;">
                <td style="padding:12px 16px;font-family:monospace;font-weight:600;color:#2d3748;">${pe.name}</td>
                <td style="padding:12px 16px;color:#2d3748;">${pe.party || '—'}</td>
                <td style="padding:12px 16px;color:#718096;">${pe.party_type || 'Customer'}</td>
                <td style="padding:12px 16px;color:#2d3748;font-weight:500;">KES ${flt(pe.paid_amount).toLocaleString('en-KE')}</td>
                <td style="padding:12px 16px;color:#718096;">${pe.mode_of_payment || '—'}</td>
                <td style="padding:12px 16px;"><span style="display:inline-flex;align-items:center;gap:6px;background:#f0fff4;color:#276749;padding:3px 8px;border-radius:12px;font-size:12px;font-weight:500;"><span style="width:6px;height:6px;background:#38a169;border-radius:50%;"></span>Completed</span></td>
            </tr>`).join('');

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Finance</span> › <span style="color:#2d3748;font-weight:500;">Payments</span>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h1 style="margin:0;font-size:22px;font-weight:700;color:#1a202c;display:flex;align-items:center;gap:10px;">Payments <span style="background:#edf2f7;color:#4a5568;font-size:12px;padding:2px 8px;border-radius:10px;font-weight:600;">${(paymentEntries || []).length}</span></h1>
            </div>

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">PAYABLE TO TRANSPORTERS</div>
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:12px 16px;">Ticket</th>
                            <th style="padding:12px 16px;">Transporter</th>
                            <th style="padding:12px 16px;">Haulage</th>
                            <th style="padding:12px 16px;">Cess</th>
                            <th style="padding:12px 16px;text-align:right;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${transporterRows || `<tr><td colspan="5" style="padding:20px;text-align:center;color:#718096;">No pending transporter payments.</td></tr>`}
                    </tbody>
                </table>
            </div>

            <div style="font-size:14px;font-weight:600;color:#1a202c;margin-bottom:12px;">PAYMENT HISTORY</div>
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;color:#718096;font-weight:600;">
                            <th style="padding:12px 16px;">ID</th>
                            <th style="padding:12px 16px;">Party</th>
                            <th style="padding:12px 16px;">Type</th>
                            <th style="padding:12px 16px;">Amount</th>
                            <th style="padding:12px 16px;">Rail</th>
                            <th style="padding:12px 16px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${historyRows || `<tr><td colspan="6" style="padding:30px;text-align:center;color:#718096;">No payment history found.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;

        container.querySelectorAll('.pay-transporter-btn').forEach(btn => {
            btn.addEventListener('click', () => navigate('payments_form', { id: btn.dataset.id }));
        });
    }

    async function renderPayTransporter(container, params) {
        const l = LIVE_STORE.lots.find(x => x.name === params.id);
        if (!l) return navigate('payments_list');

        const haulage = flt(l.haulage_kes);
        const cess = flt(l.cess_kes);
        const amount = haulage + cess;

        if (!l.transporter || cint(l.transport_paid) || amount <= 0) {
            showToast('Nothing payable to a transporter for this ticket.', 'orange');
            return navigate('payments_list');
        }

        const transporter = (LIVE_STORE.suppliers || []).find(s => s.name === l.transporter);
        const transporterLabel = transporter && transporter.supplier_name ? `${transporter.supplier_name} (${l.transporter})` : l.transporter;

        let modeOfPayments = ['Bank Transfer', 'Pesalink', 'Mpesa'];
        try {
            const mopList = await frappe.db.get_list('Mode of Payment', { fields: ['name'], order_by: 'name asc', limit: 50 });
            if (mopList && mopList.length) modeOfPayments = mopList.map(x => x.name);
        } catch (e) {
            console.error('Error fetching Mode of Payment:', e);
        }

        const readonlyBox = (label, value, bold) => `
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label style="font-size:13px;font-weight:500;color:#4a5568;">${label}</label>
                <div style="padding:8px 12px;background:#f7fafc;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;color:#2d3748;font-weight:${bold ? '700' : '500'};">${value}</div>
            </div>`;

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Finance</span> › <a href="#" id="back-payments-link" style="color:#3182ce;text-decoration:none;">Payments</a> › <span style="color:#2d3748;font-weight:500;">Pay transporter</span>
            </div>

            <div style="margin-bottom:20px;">
                <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#1a202c;">Pay transporter</h1>
                <span style="font-size:13px;color:#718096;">${l.name} · ${transporterLabel}</span>
            </div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Transport payment</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${readonlyBox('Haulage', fmtKES(haulage))}
                    ${readonlyBox('Cess', fmtKES(cess))}
                    ${readonlyBox('Total payable', fmtKES(amount), true)}
                    ${field({ label: 'Mode of Payment *', id: 'f-tp-rail', type: 'select', required: true, options: modeOfPayments, value: modeOfPayments.includes('Bank Transfer') ? 'Bank Transfer' : (modeOfPayments[0] || '') })}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    ${field({ label: 'Reference No', id: 'f-tp-ref', placeholder: 'Bank / M-Pesa reference (defaults to ticket no.)' })}
                    ${field({ label: 'Reference Date', id: 'f-tp-date', type: 'date', value: frappe.datetime.get_today() })}
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="confirm-tp-btn" style="${BTN_PRIMARY}">Confirm payment</button>
                <button class="h-btn ghost" id="cancel-tp-btn" style="${BTN_GHOST}">Cancel</button>
            </div>
        `;

        document.getElementById('back-payments-link').addEventListener('click', (e) => { e.preventDefault(); navigate('payments_list'); });
        document.getElementById('cancel-tp-btn').addEventListener('click', () => navigate('payments_list'));

        document.getElementById('confirm-tp-btn').addEventListener('click', () => {
            const rail = $('#f-tp-rail').val();
            if (!rail) {
                frappe.msgprint(__('Please select a Mode of Payment.'));
                return;
            }
            const btn = $('#confirm-tp-btn').prop('disabled', true).text('Paying...');

            frappe.call({
                method: 'holec_trading.holec_trading.page.holec_trading.holec_trading.pay_transporter',
                args: {
                    ticket: l.name,
                    mode_of_payment: rail,
                    reference_no: ($('#f-tp-ref').val() || '').trim(),
                    reference_date: $('#f-tp-date').val() || frappe.datetime.get_today()
                },
                freeze: true,
                freeze_message: 'Recording payment...',
                callback: async (r) => {
                    if (r && r.message) {
                        showToast(`${transporterLabel} paid ${fmtKES(r.message.amount)} (${r.message.payment_entry})`);
                        await loadMasterData();
                        navigate('payments_list');
                    } else {
                        btn.prop('disabled', false).text('Confirm payment');
                    }
                },
                error: () => btn.prop('disabled', false).text('Confirm payment')
            });
        });
    }

    // =====================================================================
    // NEW TICKET
    // =====================================================================
    function renderNewTicket(container) {
        const itemOptions = LIVE_STORE.items.map(i => ({
            value: i.name,
            label: i.item_name ? `${i.item_name} (${i.name})` : i.name
        }));
        const defaultCommodity = itemOptions.length > 0 ? itemOptions[0].value : 'Maize';

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Trade</span> › <span style="color:#2d3748;font-weight:500;">New Ticket</span>
            </div>
            <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#1a202c;">New Ticket</h1>

            <div style="${CARD_BOX}margin-bottom:28px;">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Ticket details</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;align-items:start;margin-bottom:20px;">
                    ${field({ label: 'Supplier *', id: 'f-supplier', type: 'select', required: true, options: LIVE_STORE.suppliers.map(s => ({ value: s.name, label: s.supplier_name ? `${s.supplier_name} (${s.name})` : s.name })) })}
                    ${field({ label: 'Commodity', id: 'f-item', type: 'select', value: defaultCommodity, options: itemOptions })}
                    ${field({ label: 'Expected Quantity (kg) *', id: 'f-qty', type: 'number', required: true, placeholder: 'e.g. 8000' })}
                </div>
                <div style="max-width:320px;">
                    ${field({ label: 'Expected Delivery Date', id: 'f-date', type: 'date', value: frappe.datetime.get_today() })}
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="create-ticket-btn" style="${BTN_PRIMARY}">Create Ticket</button>
                <button class="h-btn ghost" id="cancel-btn" style="${BTN_GHOST}">Cancel</button>
            </div>
        `;

        document.getElementById('cancel-btn').addEventListener('click', () => navigate('lots'));
        document.getElementById('create-ticket-btn').addEventListener('click', async () => {
            const supplier = $('#f-supplier').val();
            const commodity = $('#f-item').val();
            const qty = parseFloat($('#f-qty').val()) || 0;

            if (!supplier) { frappe.msgprint(__('Please select a Supplier.')); return; }
            if (qty <= 0) { frappe.msgprint(__('Please enter a valid Expected Quantity.')); return; }

            const res = await frappe.db.insert({
                doctype: 'Buy Ticket',
                supplier: supplier,
                commodity: commodity,
                quantity_kg: qty,
                status: 'Ticket',
                negotiated_price: PAYABLE_RULES.defaultRate
            });

            if (res) {
                showToast(`Ticket ${res.name} created successfully`);
                await loadMasterData();
                navigate('lots', { id: res.name });
            }
        });
    }

    // =====================================================================
    // INTAKE & QUALITY
    // =====================================================================
    function renderIntake(container, params) {
        const l = LIVE_STORE.lots.find(x => x.name === params.id) || LIVE_STORE.lots[0];
        if (!l) return navigate('lots');

        const waitingTickets = LIVE_STORE.lots.filter(x => (x.status || 'Ticket') === 'Ticket');
        // Transporters are Suppliers (the Pay Transporter screen looks them up in suppliers)
        const transporterOptions = LIVE_STORE.suppliers.map(s => ({ value: s.name, label: s.supplier_name ? `${s.supplier_name} (${s.name})` : s.name }));

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Trade</span> › <span style="color:#2d3748;font-weight:500;">Intake & Quality</span>
            </div>

            <div style="margin-bottom:20px;">
                <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#1a202c;">Intake & Quality capture</h1>
                <span style="font-size:13px;color:#718096;">${l.name} · ${l.supplier || '—'}</span>
            </div>

            <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;font-size:13px;color:#4a5568;">
                <span>${waitingTickets.length} tickets waiting:</span>
                <div style="display:flex;gap:6px;">
                    ${waitingTickets.map(t => `
                        <button class="h-btn sm" data-ticket="${t.name}" style="padding:4px 10px;border-radius:6px;border:1px solid #cbd5e0;background:${t.name === l.name ? '#1a202c' : '#fff'};color:${t.name === l.name ? '#fff' : '#2d3748'};cursor:pointer;font-weight:500;font-size:12px;">${t.name}</button>
                    `).join('')}
                </div>
            </div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Weighbridge capture</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Gross Weight (kg) *', id: 'f-gross', type: 'number', value: l.gross_weight_kg || '', required: true })}
                    ${field({ label: 'Tare Weight (kg) *', id: 'f-tare', type: 'number', value: l.tare_weight_kg || '', required: true })}
                    ${field({ label: 'Bag Count *', id: 'f-bags', type: 'number', value: l.bag_count || '', required: true })}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Weighbridge Ticket Number *', id: 'f-wbnum', value: l.weighbridge_ticket_number || '', required: true, placeholder: 'Unique, e.g. WB-88213' })}
                    ${field({ label: 'Transporter', id: 'f-transporter', type: 'select', value: l.transporter || '', options: transporterOptions })}
                    ${field({ label: 'Vehicle Registration', id: 'f-vehicle', type: 'text', value: l.vehicle_registration || '', placeholder: 'e.g. KDA 123A' })}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px;">
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="font-size:13px;font-weight:500;color:#4a5568;">Weighbridge Slip — Gross (In)</label>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <button type="button" id="upload-gross-slip" style="padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;cursor:pointer;width:fit-content;font-size:13px;color:#2d3748;">⬆ Upload Gross Slip</button>
                            <span id="gross-file-name" style="font-size:13px;color:#4a5568;font-style:italic;">No file chosen</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <label style="font-size:13px;font-weight:500;color:#4a5568;">Net Weight (Calculated)</label>
                    <div id="net-calc-box" style="padding:8px 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;color:#4a5568;font-weight:500;">0 kg</div>
                </div>
            </div>

            <div style="${CARD_BOX}margin-bottom:28px;">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Quality Inspection</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Moisture % *', id: 'f-moisture', type: 'number', value: l.moisture_ || '', required: true })}
                    ${field({ label: 'Foreign Matter % *', id: 'f-fm', type: 'number', value: l.foreign_matter_ || '', required: true })}
                    ${field({ label: 'Aflatoxin ppb *', id: 'f-afla', type: 'number', value: l.aflatoxin_ppb || '', required: true })}
                </div>
                ${field({ label: 'Reason Code (if foreign matter judgement or wet buy)', id: 'f-reason', type: 'textarea', value: l.reason_code_if_foreign_matter_judgement_or_wet_buy || '', span: true })}
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="submit-intake-btn" style="${BTN_PRIMARY}">Submit Intake & Create Lot</button>
                <button class="h-btn ghost" id="cancel-btn" style="${BTN_GHOST}">Cancel</button>
            </div>
        `;

        const updateNetCalc = () => {
            const g = flt($('#f-gross').val()) || 0;
            const t = flt($('#f-tare').val()) || 0;
            $('#net-calc-box').text(fmtKg(Math.max(0, g - t)));
        };

        $('#f-gross, #f-tare').on('input', updateNetCalc);
        updateNetCalc();

        container.querySelectorAll('[data-ticket]').forEach(btn => {
            btn.addEventListener('click', () => navigate('intake', { id: btn.dataset.ticket }));
        });

        document.getElementById('cancel-btn').addEventListener('click', () => navigate('lots', { id: l.name }));
        document.getElementById('submit-intake-btn').addEventListener('click', async () => {
            const gross = flt($('#f-gross').val());
            const tare = flt($('#f-tare').val());
            const bags = cint($('#f-bags').val());
            const wbNo = $('#f-wbnum').val();

            if (!gross || !tare || !bags || !wbNo) {
                frappe.msgprint(__('Please fill all mandatory Weighbridge fields.'));
                return;
            }
            if (gross <= tare) {
                frappe.msgprint(__('Gross weight must be greater than tare weight.'));
                return;
            }

            // Held in memory until "Post Net Invoice & Create Lot" saves them on the Deductions screen
            l.gross_weight_kg = gross;
            l.tare_weight_kg = tare;
            l.bag_count = bags;
            l.weighbridge_ticket_number = wbNo;
            l.transporter = $('#f-transporter').val();
            l.vehicle_registration = $('#f-vehicle').val();
            l.moisture_ = flt($('#f-moisture').val());
            l.foreign_matter_ = flt($('#f-fm').val());
            l.aflatoxin_ppb = flt($('#f-afla').val());
            l.reason_code_if_foreign_matter_judgement_or_wet_buy = $('#f-reason').val();

            showToast(`Intake captured for ${l.name}`);
            navigate('deductions', { id: l.name });
        });

        function updateWeighbridgeFields(data) {
            const has = (v) => v !== null && v !== undefined && v !== '';
            if (has(data.gross_weight)) $('#f-gross').val(data.gross_weight);
            if (has(data.tare_weight)) $('#f-tare').val(data.tare_weight);
            if (has(data.ticket_no)) $('#f-wbnum').val(data.ticket_no);
            if (has(data.bag_count)) $('#f-bags').val(data.bag_count);
            if (has(data.vehicle_no)) $('#f-vehicle').val(String(data.vehicle_no).trim());
            updateNetCalc();
        }

        function processWeighbridgeSlip(file, slipType, fileNameSelector, buttonLabel) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (uploadEvent) {
                showToast(`${buttonLabel} uploaded. Extracting details via AI...`, 'orange');

                frappe.call({
                    method: 'holec_trading.holec_trading.page.holec_trading.holec_trading.extract_weighbridge_data',
                    args: {
                        filedata: uploadEvent.target.result,
                        slip_type: slipType,
                        ticket_name: l.name,
                        filename: file.name
                    },
                    freeze: true,
                    freeze_message: `Reading ${buttonLabel}...`,
                    callback: function (r) {
                        if (r.exc || !r.message || !r.message.success) {
                            showToast((r.message && r.message.message) || `Could not extract ${buttonLabel} details.`, 'orange');
                            return;
                        }
                        updateWeighbridgeFields(r.message);
                        $(fileNameSelector).text(file.name).css({ color: '#276749', 'font-style': 'normal', 'font-weight': '500' });
                        showToast(`${buttonLabel} OCR completed successfully.`, 'green');
                    },
                    error: function () {
                        showToast(`Error while processing ${buttonLabel}.`, 'red');
                    }
                });
            };
            reader.readAsDataURL(file);
        }

        document.getElementById('upload-gross-slip').addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.jpg,.jpeg,.png,.webp,.pdf';
            fileInput.onchange = function (e) {
                const file = e.target.files[0];
                if (file) processWeighbridgeSlip(file, 'gross', '#gross-file-name', 'Gross Weight Slip');
            };
            fileInput.click();
        });
    }

    // =====================================================================
    // DEDUCTIONS & PAYABLE
    // =====================================================================
    function renderDeductionsPayable(container, params) {
        const l = LIVE_STORE.lots.find(x => x.name === params.id) || LIVE_STORE.lots[0];
        if (!l) return navigate('lots');

        const R = PAYABLE_RULES;
        const initialRate = flt(l.negotiated_price || R.defaultRate);

        const row = (label, sub, id, color) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #edf2f7;font-size:14px;">
                <div>
                    <span style="color:#4a5568;display:block;">${label}</span>
                    ${sub !== null ? `<span id="${id}-sub" style="font-size:12px;color:#a0aec0;">${sub}</span>` : ''}
                </div>
                <strong id="${id}" style="color:${color || '#2d3748'};"></strong>
            </div>`;

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Trade</span> › <span style="color:#2d3748;font-weight:500;">Deductions & Payable</span>
            </div>
            <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#1a202c;">Deductions & Payable Engine</h1>
            <div style="font-size:13px;color:#718096;margin-bottom:20px;">${l.name} · ${l.supplier || '—'}</div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Deduction Breakdown</h3>
                ${row('Gross Weight', null, 'd-gross')}
                ${row('Tare Weight', null, 'd-tare', '#e53e3e')}
                ${row('Net Weight', 'Gross minus tare', 'd-net')}
                ${row('Moisture Deduction', '', 'd-moist', '#e53e3e')}
                ${row('Foreign Matter Deduction', '', 'd-fm', '#e53e3e')}
                <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0 0 0;font-size:14px;">
                    <div>
                        <strong style="color:#1a202c;display:block;">Accepted Net Quantity</strong>
                        <span style="font-size:12px;color:#718096;">This is what lands in the stock ledger — not the gross weight</span>
                    </div>
                    <strong id="d-accepted" style="color:#1a202c;font-size:16px;"></strong>
                </div>
            </div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Payable Value</h3>
                <div style="max-width:320px;margin-bottom:16px;">
                    ${field({ label: 'Reference Rate (KES/kg) *', id: 'f-ref-rate', type: 'number', required: true, value: initialRate })}
                </div>
                ${row('Net Weight × Rate', '', 'p-gross')}
                <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0 0 0;font-size:15px;">
                    <strong style="color:#1a202c;">Net Payable to Supplier</strong>
                    <strong id="p-net" style="color:#1a202c;font-size:16px;"></strong>
                </div>
            </div>

            <div style="${CARD_BOX}margin-bottom:28px;">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Net Supplier Invoice</h3>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <label style="font-size:13px;font-weight:500;color:#4a5568;">Invoice Value</label>
                    <div id="p-invoice" style="padding:10px 12px;background:#f7fafc;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;color:#2d3748;font-weight:600;"></div>
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="post-invoice-btn" style="${BTN_PRIMARY}">Post Net Invoice & Create Lot</button>
                <button class="h-btn ghost" id="back-to-lots-btn" style="${BTN_GHOST}">Back to Lots</button>
            </div>
        `;

        // Every line comes from computePayable, so the screen and totals always agree
        const update = () => {
            const rate = flt($('#f-ref-rate').val());
            const p = computePayable(l, rate);

            $('#d-gross').text(fmtKg1(p.grossKg));
            $('#d-tare').text('- ' + fmtKg1(p.tareKg));
            $('#d-net').text(fmtKg1(p.netKg));

            $('#d-moist').text('- ' + fmtKg1(p.moistureDeductionKg));
            $('#d-moist-sub').text(p.moistureExcess > 0
                ? `${p.moisture}% vs ${R.moistureStandard}% standard: ${p.moistureExcess.toFixed(1)} pts over × ${p.moistureMultiplier} = ${p.moisturePenaltyPct.toFixed(2)}% of net weight`
                : `${p.moisture}% recorded — at or below ${R.moistureStandard}% standard, no deduction`);

            $('#d-fm').text('- ' + fmtKg1(p.fmDeductionKg));
            $('#d-fm-sub').text(p.fmExcess > 0
                ? `${p.fm}% vs ${R.fmAllowance}% allowance: ${p.fmExcess.toFixed(1)} pts over × ${R.fmFactor} = ${p.fmPenaltyPct.toFixed(2)}% of net weight`
                : `${p.fm}% recorded — within ${R.fmAllowance}% allowance, no deduction`);

            $('#d-accepted').text(fmtKg1(p.acceptedNetKg));

            $('#p-gross').text(fmtKES(p.grossValue));
            $('#p-gross-sub').text(`${fmtKg1(p.netKg)} net × KES ${rate}/kg`);
            $('#p-net').text(fmtKES(p.netPayable));
            $('#p-invoice').text(fmtKES(p.netPayable));
        };

        $('#f-ref-rate').on('input', update);
        update();

        document.getElementById('back-to-lots-btn').addEventListener('click', () => navigate('lots'));
        document.getElementById('post-invoice-btn').addEventListener('click', async () => {
            const rate = flt($('#f-ref-rate').val());
            if (rate <= 0) { frappe.msgprint(__('Please enter a valid Reference Rate.')); return; }

            // Save the edited rate AND the intake values
            await frappe.db.set_value('Buy Ticket', l.name, {
                status: 'Lot',
                negotiated_price: rate,
                gross_weight_kg: flt(l.gross_weight_kg),
                tare_weight_kg: flt(l.tare_weight_kg),
                bag_count: cint(l.bag_count),
                weighbridge_ticket_number: l.weighbridge_ticket_number || '',
                transporter: l.transporter || '',
                vehicle_registration: l.vehicle_registration || '',
                moisture_: flt(l.moisture_),
                foreign_matter_: flt(l.foreign_matter_),
                aflatoxin_ppb: flt(l.aflatoxin_ppb),
                reason_code_if_foreign_matter_judgement_or_wet_buy: l.reason_code_if_foreign_matter_judgement_or_wet_buy || ''
            });
            showToast(`Net invoice posted and ${l.name} moved to Lot status`);
            await loadMasterData();
            navigate('lots', { id: l.name });
        });
    }

    // =====================================================================
    // TRANSPORT & LOSS
    // =====================================================================
    function renderTransportLoss(container, params) {
        const l = LIVE_STORE.lots.find(x => x.name === params.id) || LIVE_STORE.lots.filter(x => (x.status || 'Lot') === 'Lot')[0];
        if (!l) return navigate('lots');

        const readyLots = LIVE_STORE.lots.filter(x => (x.status || 'Lot') === 'Lot');

        // Expected Quantity = Supplier Net Weight
        // Supplier Net Weight = Gross Weight - Tare Weight
        const supplierGross = flt(l.gross_weight_kg || 0);
        const supplierTare = flt(l.tare_weight_kg || 0);

        const expectedQty = Math.max(0, supplierGross - supplierTare);

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Trade</span> › <span style="color:#2d3748;font-weight:500;">Transport & Loss</span>
            </div>

            <div style="margin-bottom:20px;">
                <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#1a202c;">Transport & Loss</h1>
                <span style="font-size:13px;color:#718096;">${l.name} · ${l.supplier || '—'}</span>
            </div>

            <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;font-size:13px;color:#4a5568;">
                <span>${readyLots.length} lots ready:</span>
                <div style="display:flex;gap:6px;">
                    ${readyLots.map(t => `
                        <button class="h-btn sm" data-lot="${t.name}" style="padding:4px 10px;border-radius:6px;border:1px solid #cbd5e0;background:${t.name === l.name ? '#1a202c' : '#fff'};color:${t.name === l.name ? '#fff' : '#2d3748'};cursor:pointer;font-weight:500;font-size:12px;">${t.name}</button>
                    `).join('')}
                </div>
            </div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Transport Charges</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;">
                    ${field({ label: 'Haulage (KES)', id: 'f-haulage', type: 'number', value: l.haulage_kes || '' })}
                    ${field({ label: 'Cess (KES)', id: 'f-cess', type: 'number', value: l.cess_kes || '' })}
                    ${field({ label: 'Offloading (KES)', id: 'f-offloading', type: 'number', value: l.offloading_kes || '' })}
                </div>
            </div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Customer Weighbridge Slip</h3>
                <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
                    <label style="font-size:13px;font-weight:500;color:#4a5568;">Weighbridge slip at customer (delivery)</label>
                    <div style="display:flex;align-items:center;gap:12px;">
                        <button type="button" id="upload-delivery-slip" style="padding:8px 12px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;cursor:pointer;width:fit-content;font-size:13px;color:#2d3748;">⬆ Upload Delivery Slip</button>
                        <span id="delivery-file-name" style="font-size:13px;color:#4a5568;font-style:italic;">No file chosen</span>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;">
                    ${field({ label: 'Gross Weight (kg) *', id: 'f-d-gross', type: 'number', required: true, value: l.delivery_gross_kg || '' })}
                    ${field({ label: 'Tare Weight (kg) *', id: 'f-d-tare', type: 'number', required: true, value: l.delivery_tare_kg || '' })}
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="font-size:13px;font-weight:500;color:#4a5568;">Net Weight Delivered (Calculated)</label>
                        <div id="delivered-calc-box" style="padding:8px 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;color:#2d3748;font-weight:600;">0 kg</div>
                        <span style="font-size:12px;color:#a0aec0;">Gross minus tare. Used as Delivered Quantity and for revenue.</span>
                    </div>
                </div>
            </div>

            <div style="${CARD_BOX}margin-bottom:28px;">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Loss Reconciliation</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px;">
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="font-size:13px;font-weight:500;color:#4a5568;">Expected Quantity</label>
                        <div style="padding:8px 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;color:#4a5568;font-weight:500;">${expectedQty.toLocaleString('en-KE')} kg</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="font-size:13px;font-weight:500;color:#4a5568;">Delivered Quantity (kg)</label>
                        <div id="delivered-qty-box" style="padding:8px 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;color:#4a5568;font-weight:500;">0 kg</div>
                    </div>
                </div>
                <div id="loss-alert-box" style="border-radius:6px;padding:12px 16px;font-size:13px;display:flex;align-items:center;gap:12px;">
                    <span></span><span id="loss-alert-text"></span>
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="capitalise-btn" style="${BTN_PRIMARY}">Capitalise Costs & Move to Position</button>
                <button class="h-btn ghost" id="back-to-lots-btn" style="${BTN_GHOST}">Back to Lots</button>
            </div>
        `;

        // Delivered quantity is always gross - tare from the customer weighbridge
        const getDelivered = () => Math.max(0, flt($('#f-d-gross').val()) - flt($('#f-d-tare').val()));

        const updateReconciliation = () => {
            const delivered = getDelivered();
            const diff = expectedQty - delivered;
            const alertBox = $('#loss-alert-box');
            const alertText = $('#loss-alert-text');
            const icon = alertBox.find('span:first');

            $('#delivered-calc-box').text(fmtKg(delivered));
            $('#delivered-qty-box').text(fmtKg(delivered));

            if (delivered <= 0) {
                alertBox.css({ background: '#f7fafc', border: '1px solid #e2e8f0', color: '#4a5568' });
                icon.text('ℹ');
                alertText.text('Upload the customer weighbridge slip, or enter gross and tare weight, to calculate the delivered quantity.');
            } else if (diff <= 0) {
                alertBox.css({ background: '#f0fff4', border: '1px solid #c6f6d5', color: '#276749' });
                icon.text('✓');
                alertText.text('No loss recorded. Full expected quantity delivered.');
            } else {
                const tolerance = 80;
                const recovered = Math.max(0, diff - tolerance);
                const sellRate = flt(l.sell_rate || l.negotiated_price || PAYABLE_RULES.defaultRate);
                alertBox.css({ background: '#fffaf0', border: '1px solid #feebc8', color: '#c05621' });
                icon.text('⚠');
                alertText.text(diff <= tolerance
                    ? `${diff.toLocaleString('en-KE')} kg loss is within the ${tolerance} kg tolerance limit.`
                    : `${diff.toLocaleString('en-KE')} kg loss exceeds the ${tolerance} kg tolerance. ${recovered.toLocaleString('en-KE')} kg recovered from the transporter at sell rate = KES ${(recovered * sellRate).toLocaleString('en-KE')}, split across inventory reversal and margin recovery.`);
            }
        };

        $('#f-d-gross, #f-d-tare').on('input', updateReconciliation);
        updateReconciliation();

        // ---- OCR on the customer weighbridge slip ----
        document.getElementById('upload-delivery-slip').addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.jpg,.jpeg,.png,.webp,.pdf';
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    showToast('Delivery slip uploaded. Extracting details...', 'orange');
                    frappe.call({
                        method: 'holec_trading.holec_trading.page.holec_trading.holec_trading.extract_weighbridge_data',
                        args: { filedata: ev.target.result, slip_type: 'delivery', ticket_name: l.name, filename: file.name },
                        freeze: true,
                        freeze_message: 'Reading delivery weighbridge slip...',
                        callback: (r) => {
                            if (r.exc || !r.message || !r.message.success) {
                                showToast((r.message && r.message.message) || 'Could not read the slip. Enter gross and tare manually.', 'orange');
                                $('#delivery-file-name').text(file.name);
                                return;
                            }
                            const d = r.message;
                            const has = (v) => v !== null && v !== undefined && v !== '';
                            if (has(d.gross_weight)) $('#f-d-gross').val(d.gross_weight);
                            if (has(d.tare_weight)) $('#f-d-tare').val(d.tare_weight);
                            $('#delivery-file-name').text(file.name).css({ color: '#276749', 'font-style': 'normal', 'font-weight': '500' });
                            updateReconciliation();
                            showToast('Delivery slip read successfully. Please check the weights.');
                        },
                        error: () => showToast('Error while reading the delivery slip.', 'red')
                    });
                };
                reader.readAsDataURL(file);
            };
            fileInput.click();
        });

        container.querySelectorAll('[data-lot]').forEach(btn => {
            btn.addEventListener('click', () => navigate('transport', { id: btn.dataset.lot }));
        });
        document.getElementById('back-to-lots-btn').addEventListener('click', () => navigate('lots'));

        document.getElementById('capitalise-btn').addEventListener('click', async () => {
            const gross = flt($('#f-d-gross').val());
            const tare = flt($('#f-d-tare').val());
            if (gross <= 0 || tare <= 0 || gross <= tare) {
                frappe.msgprint(__('Enter a valid customer weighbridge gross and tare weight (gross must be greater than tare).'));
                return;
            }

            await frappe.db.set_value('Buy Ticket', l.name, {
                status: 'Position',
                haulage_kes: flt($('#f-haulage').val()),
                cess_kes: flt($('#f-cess').val()),
                offloading_kes: flt($('#f-offloading').val()),
                delivery_gross_kg: gross,
                delivery_tare_kg: tare,
                delivered_quantity_kg: gross - tare
            });

            showToast(`Costs capitalised and ${l.name} moved to Position`);
            await loadMasterData();
            navigate('lots', { id: l.name });
        });
    }

    // =====================================================================
    // SALE & INVOICING
    // =====================================================================
    function renderSaleInvoicing(container, params) {
        const l = LIVE_STORE.lots.find(x => x.name === params.id) || LIVE_STORE.lots.filter(x => (x.status || 'Position') === 'Position')[0] || LIVE_STORE.lots[0];
        if (!l) return navigate('lots');

        const positionLots = LIVE_STORE.lots.filter(x => (x.status || 'Position') === 'Position');
        const customerOptions = LIVE_STORE.customers.map(c => ({ value: c.name, label: c.customer_name ? `${c.customer_name} (${c.name})` : c.name }));

        container.innerHTML = `
            <div style="font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:4px;">
                <span>Holec Trading</span> › <span>Trade</span> › <span style="color:#2d3748;font-weight:500;">Sale & Invoicing</span>
            </div>

            <div style="margin-bottom:20px;">
                <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#1a202c;">Sale & Invoicing</h1>
                <span style="font-size:13px;color:#718096;">${l.name} · ${l.supplier || '—'} · Margin: <strong id="header-margin" style="color:#2d3748;"></strong></span>
            </div>

            <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;font-size:13px;color:#4a5568;">
                <span>${positionLots.length} lots ready:</span>
                <div style="display:flex;gap:6px;">
                    ${positionLots.map(t => `
                        <button class="h-btn sm" data-sale-lot="${t.name}" style="padding:4px 10px;border-radius:6px;border:1px solid #cbd5e0;background:${t.name === l.name ? '#1a202c' : '#fff'};color:${t.name === l.name ? '#fff' : '#2d3748'};cursor:pointer;font-weight:500;font-size:12px;">${t.name}</button>
                    `).join('')}
                </div>
            </div>

            <div style="${CARD_BOX}">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Delivery</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px;">
                    ${field({ label: 'Customer *', id: 'f-customer', type: 'select', required: true, options: customerOptions, value: l.customer || '' })}
                    ${field({ label: 'Sell Rate (KES/kg) *', id: 'f-sell-rate', type: 'number', required: true, value: l.sell_rate || '', placeholder: 'Enter sell rate' })}
                </div>
                <div style="border-top:1px solid #edf2f7;padding-top:16px;display:flex;flex-direction:column;gap:12px;">
                    <div style="display:flex;justify-content:space-between;font-size:14px;">
                        <div>
                            <span style="color:#4a5568;display:block;">Revenue</span>
                            <span id="calc-revenue-sub" style="font-size:12px;color:#a0aec0;"></span>
                        </div>
                        <strong style="color:#2d3748;" id="calc-revenue">KES 0</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:14px;">
                        <div>
                            <span style="color:#4a5568;display:block;">Landed Cost</span>
                            <span id="calc-landed-sub" style="font-size:12px;color:#a0aec0;"></span>
                        </div>
                        <strong style="color:#e53e3e;" id="calc-landed">KES 0</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:14px;">
                        <span style="color:#4a5568;">Margin</span>
                        <strong style="color:#2d3748;" id="calc-margin-total">KES 0</strong>
                    </div>

                </div>
            </div>

            <div style="${CARD_BOX}margin-bottom:28px;">
                <h3 style="margin:0 0 16px 0;font-size:15px;color:#1a202c;font-weight:600;">Sales Invoice + eTIMS</h3>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <label style="font-size:13px;font-weight:500;color:#4a5568;">Invoice Number</label>
                    <div id="f-invoice-no-display" style="padding:8px 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;color:${l.invoice_number ? '#2d3748' : '#a0aec0'};font-weight:${l.invoice_number ? '600' : '400'};">
                        ${l.invoice_number || 'Generated on submit'}
                    </div>
                </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;">
                <button class="h-btn primary" id="submit-etims-btn" style="${BTN_PRIMARY}">Submit Invoice & Transmit to eTIMS</button>
                <button class="h-btn ghost" id="back-to-lots-btn" style="${BTN_GHOST}">Back to Lots</button>
            </div>
        `;

        const updateCalculations = () => {
            const m = computeMargin(l, flt($('#f-sell-rate').val()));
            const color = m.margin < 0 ? '#e53e3e' : '#2d3748';

            $('#calc-revenue').text(fmtKES(m.revenue));
            $('#calc-revenue-sub').text(`${fmtKg1(m.soldKg)} customer net × KES ${m.sellRate}/kg`);
            $('#calc-landed').text('- ' + fmtKES(m.landedCost));
            $('#calc-landed-sub').text(`${fmtKg1(m.buyKg)} supplier net × KES ${m.refRate}/kg`);
            $('#calc-margin-total').text(fmtKES(m.margin)).css('color', color);
            $('#calc-margin').text(fmtKES(m.marginPerTonne)).css('color', color);
            $('#header-margin').text(fmtKES(m.margin)).css('color', color);
        };

        $('#f-sell-rate').on('input', updateCalculations);
        updateCalculations();

        container.querySelectorAll('[data-sale-lot]').forEach(btn => {
            btn.addEventListener('click', () => navigate('sale_invoicing', { id: btn.dataset.saleLot }));
        });

        document.getElementById('back-to-lots-btn').addEventListener('click', () => navigate('lots'));
        document.getElementById('submit-etims-btn').addEventListener('click', async () => {
            const customer = $('#f-customer').val();
            const sellRate = flt($('#f-sell-rate').val());

            if (!customer) {
                frappe.msgprint(__('Please select a Customer.'));
                return;
            }
            if (sellRate <= 0) {
                frappe.msgprint(__('Please enter a valid Sell Rate.'));
                return;
            }

            const m = computeMargin(l, sellRate);
            if (m.soldKg <= 0) {
                frappe.msgprint(__('No customer weighbridge weight recorded. Complete the Transport & Loss step first.'));
                return;
            }

            let invoiceDoc = null;
            try {
                invoiceDoc = await frappe.db.insert({
                    doctype: 'Sales Invoice',
                    company: COMPANY,
                    customer: customer,
                    grand_total: flt(m.revenue),
                    currency: 'KES',
                    custom_buy_ticket: l.name,
                    items: [{
                        item_code: l.commodity || (LIVE_STORE.items[0] && LIVE_STORE.items[0].name) || 'Commodity',
                        qty: flt(m.soldKg),         // customer net weight, same as the revenue shown
                        rate: flt(sellRate),
                        amount: flt(m.revenue)
                    }]
                });
            } catch (err) {
                console.error('Error creating Sales Invoice:', err);
                frappe.msgprint(__('Failed to create Sales Invoice: ') + (err.message || err));
                return; // do NOT advance the ticket on failure
            }

            const realInvoiceNo = invoiceDoc.name;

            await frappe.db.set_value('Buy Ticket', l.name, {
                status: 'Invoiced',
                customer: customer,
                sell_rate: sellRate,
                invoice_number: realInvoiceNo
            });

            showToast(`Invoice ${realInvoiceNo} transmitted to eTIMS and ${l.name} moved to Invoiced`);
            await loadMasterData();
            navigate('lots', { id: l.name });
        });
    }

    // =====================================================================
    // NAVIGATION
    // =====================================================================
    const MODULE_REGISTRY = [
        { id: 'suppliers', group: 'PARTIES', name: 'Suppliers', render: renderSuppliers },
        { id: 'new_supplier', group: 'PARTIES', name: 'New supplier', render: renderNewSupplier },
        { id: 'customers', group: 'PARTIES', name: 'Customers', render: renderCustomers },
        { id: 'new_customer', group: 'PARTIES', name: 'New customer', render: renderNewCustomer },
        { id: 'lots', group: 'TRADE', name: 'Lots', render: renderLots },
        { id: 'tickets', group: 'TRADE', name: 'New Ticket', render: renderNewTicket },
        { id: 'intake', group: 'TRADE', name: 'Intake & Quality', render: renderIntake },
        { id: 'deductions', group: 'TRADE', name: 'Deductions & Payable', render: renderDeductionsPayable },
        { id: 'transport', group: 'TRADE', name: 'Transport & Loss', render: renderTransportLoss },
        { id: 'sale_invoicing', group: 'TRADE', name: 'Sale & Invoicing', render: renderSaleInvoicing },
        { id: 'payments_list', group: 'FINANCE', name: 'Payments', render: renderPaymentsList },
        { id: 'payments', group: 'FINANCE', name: 'Record Payment', render: renderPayments },
        { id: 'payments_form', group: 'FINANCE', name: 'Pay Transporter', render: renderPayTransporter },
        { id: 'ledger', group: 'INSIGHT', name: 'Cost Ledger & Margin', render: renderCostLedger },
        { id: 'reports', group: 'INSIGHT', name: 'Reports', render: renderReports },
        { id: 'event_log', group: 'INSIGHT', name: 'Trade event log', render: renderTradeEventLog }
    ];

    const TIMELINE = [
        { label: 'Ticket', route: 'tickets' },
        { label: 'Intake', route: 'intake' },
        { label: 'Lot', route: 'lots' },
        { label: 'Position', route: 'transport' },
        { label: 'Invoiced', route: 'sale_invoicing' },
        { label: 'Settled', route: 'lots' }
    ];

    function renderSidebar() {
        const el = document.getElementById('h-sidebar');
        if (!el) return;

        // Sidebar items; related sub-screens keep the parent highlighted
        const GROUPS = [
            { title: 'PARTIES', items: [
                { id: 'suppliers', label: 'Suppliers', also: ['new_supplier'] },
                { id: 'customers', label: 'Customers', also: ['new_customer'] }
            ]},
            { title: 'TRADE', items: [
                { id: 'lots', label: 'Lots' },
                { id: 'tickets', label: 'New Ticket' },
                { id: 'intake', label: 'Intake & Quality' },
                { id: 'deductions', label: 'Deductions & Payable' },
                { id: 'transport', label: 'Transport & Loss' },
                { id: 'sale_invoicing', label: 'Sale & Invoicing' }
            ]},
            { title: 'FINANCE', items: [
                { id: 'payments_list', label: 'Payments', also: ['payments', 'payments_form'] }
            ]},
            { title: 'INSIGHT', items: [
                { id: 'ledger', label: 'Cost Ledger & Margin' },
                { id: 'reports', label: 'Reports' },
                { id: 'event_log', label: 'Trade event log' }
            ]}
        ];

        el.innerHTML = `
            <div style="font-weight:700;font-size:16px;color:#1a202c;margin-bottom:20px;display:flex;align-items:center;gap:8px;">
                <span style="background:#1a202c;color:#fff;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;font-size:12px;">H</span> Holec ERP
            </div>
            ${GROUPS.map(g => `
                <div style="font-size:11px;font-weight:700;color:#a0aec0;letter-spacing:0.05em;margin:12px 0 6px 0;">${g.title}</div>
                ${g.items.map(it => {
                    const active = route.module === it.id || (it.also || []).includes(route.module);
                    return `<div class="mod-item" data-mod="${it.id}" data-active="${active ? 1 : 0}" style="padding:6px 10px;border-radius:6px;background:${active ? '#ebf8ff' : 'transparent'};color:${active ? '#2b6cb0' : '#4a5568'};font-weight:${active ? '600' : '400'};cursor:pointer;font-size:13px;margin-bottom:2px;">${it.label}</div>`;
                }).join('')}
            `).join('')}
        `;

        el.querySelectorAll('.mod-item').forEach(node => {
            node.addEventListener('click', () => navigate(node.dataset.mod));
            node.addEventListener('mouseover', () => { if (node.dataset.active !== '1') node.style.background = '#f7fafc'; });
            node.addEventListener('mouseout', () => { if (node.dataset.active !== '1') node.style.background = 'transparent'; });
        });
    }

    function renderTimeline() {
        const el = document.getElementById('h-timeline');
        if (!el) return;
        el.innerHTML = TIMELINE.map((s, i) => `
            <span style="display:inline-flex;align-items:center;gap:4px;background:#f7fafc;padding:3px 8px;border-radius:12px;border:1px solid #e2e8f0;font-size:12px;cursor:pointer;" data-route="${s.route}">
                <strong style="color:#2d3748;">${i + 1}</strong> ${s.label}
            </span>
        `).join('');

        el.querySelectorAll('[data-route]').forEach(node => {
            node.addEventListener('click', () => navigate(node.dataset.route));
        });
    }

    async function render() {
        renderSidebar();
        renderTimeline();
        const mod = MODULE_REGISTRY.find(m => m.id === route.module) || MODULE_REGISTRY[0];
        const inner = document.getElementById('h-content');
        if (mod && inner) mod.render(inner, route.params);
    }

    loadMasterData().then(() => {
        render();
    });
}