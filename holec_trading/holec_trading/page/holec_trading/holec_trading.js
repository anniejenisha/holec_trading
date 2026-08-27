frappe.pages['holec_trading'].on_page_load = function (wrapper) {
    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('Holec Trading'),
        single_column: true
    });

    // Render HTML Template
    $(frappe.render_template('holec_trading', {})).appendTo(page.main);

    // List of DocTypes from Holec Trading module
    const doctypes = [
        { id: 'storage_stack', label: 'Storage Stack', route: 'List/Storage Stack', icon: 'octicon-stack' },
        { id: 'origin_area', label: 'Origin Area', route: 'List/Origin Area', icon: 'octicon-location' },
        { id: 'charge_master', label: 'Charge Master', route: 'List/Charge Master', icon: 'octicon-credit-card' },
        { id: 'buy_ticket', label: 'Buy Ticket', route: 'List/Buy Ticket', icon: 'octicon-tag' },
        { id: 'lot_event_log', label: 'Lot Event Log', route: 'List/Lot Event Log', icon: 'octicon-history' },
        { id: 'lot', label: 'Lot', route: 'List/Lot', icon: 'octicon-package' },
        { id: 'origin_county', label: 'Origin County', route: 'List/Origin County', icon: 'octicon-globe' },
        { id: 'rail_routing_band', label: 'Rail Routing Band', route: 'List/Rail Routing Band', icon: 'octicon-milestone' }
    ];

    // Scoped Elements Lookup
    const $primaryNav = $(page.main).find('#holec-primary-items');
    const $target = $(page.main).find('#holec-viewport-container');

    const cleanCSS = `
        :root {
            --sidebar-width: 0px !important;
            --page-sidebar-width: 0px !important;
        }
        .navbar, header.navbar, .sidebar-toggle-btn, .sidebar-collapse-btn {
            display: none !important;
            height: 0 !important;
        }
        .page-head {
            display: flex !important;
            padding: 10px 24px !important;
            border-bottom: 1px solid #ebedf0 !important;
            background: #ffffff !important;
        }
        .page-head .page-breadcrumbs {
            display: none !important;
        }
        .layout-side-section, .desk-sidebar, .standard-sidebar-section,
        .body-sidebar, .workspace-sidebar, .desk-sidebar-dropdown {
            display: none !important;
            width: 0 !important;
        }
        .page-container, .page-body, .desk-page, .layout-main-section-wrapper,
        .layout-main, .layout-main-section, .workspace-page, .desk-container {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 16px 24px !important;
        }
    `;

    function forceCleanDOM(frameDoc) {
        if (!frameDoc) return;
        const mainWrappers = frameDoc.querySelectorAll('.layout-main-section, .layout-main-section-wrapper, .workspace-page, .page-container');
        mainWrappers.forEach(el => {
            el.style.setProperty('margin-left', '0px', 'important');
            el.style.setProperty('width', '100%', 'important');
            el.style.setProperty('max-width', '100%', 'important');
        });
    }

    function renderIframe(route) {
        if (!route) return;

        let cleanRoute = route.replace(/^\/?(desk\/|app\/)?/, '');
        const targetUrl = `/app/${cleanRoute}`;

        $target.empty();

        const $iframe = $('<iframe>', {
            src: targetUrl,
            class: 'tm-viewport-iframe',
            frameborder: '0',
            style: 'width: 100%; height: 100%; border: none; opacity: 0; transition: opacity 0.15s ease-in;'
        });

        $iframe.on('load', function () {
            const frame = this;
            try {
                const frameDoc = frame.contentDocument || frame.contentWindow.document;
                if (frameDoc) {
                    const styleId = 'frappe-flush-left-align-style';
                    let style = frameDoc.getElementById(styleId);
                    if (!style) {
                        style = frameDoc.createElement('style');
                        style.id = styleId;
                        frameDoc.head.appendChild(style);
                    }
                    style.innerHTML = cleanCSS;
                    forceCleanDOM(frameDoc);

                    requestAnimationFrame(() => { frame.style.opacity = '1'; });

                    const observer = new MutationObserver(() => {
                        forceCleanDOM(frameDoc);
                        if (!frameDoc.getElementById(styleId)) {
                            frameDoc.head.appendChild(style);
                        }
                    });
                    observer.observe(frameDoc.body, { childList: true, subtree: true });
                }
            } catch (e) {
                frame.style.opacity = '1';
            }
        });

        $target.html($iframe);
    }

    // Populate Sidebar DocTypes
    $primaryNav.empty();
    doctypes.forEach((item, idx) => {
        const $btn = $(`
            <li class="tm-primary-item ${idx === 0 ? 'active' : ''}" data-id="${item.id}">
                <div class="primary-icon">${frappe.utils.icon(item.icon || 'octicon-file', 'sm')}</div>
                <span class="primary-label">${__(item.label)}</span>
            </li>
        `);

        $btn.on('click', function () {
            $primaryNav.find('.tm-primary-item').removeClass('active');
            $(this).addClass('active');
            renderIframe(item.route);
        });

        $primaryNav.append($btn);
    });

    // Open first DocType by default
    if (doctypes.length > 0) {
        renderIframe(doctypes[0].route);
    }
};