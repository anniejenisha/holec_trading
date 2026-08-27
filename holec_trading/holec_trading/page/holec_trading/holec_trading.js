frappe.pages['holec_trading'].on_page_load = function (wrapper) {
    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('Holec Trading'),
        single_column: true
    });

    const $template = $(frappe.render_template('holec_trading', {}));
    $template.appendTo(page.main);

    // DocTypes with dedicated clean SVG icons
    const doctypes = [
        { 
            id: 'storage_stack', 
            label: 'Storage Stack', 
            route: 'List/Storage Stack', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l8-4 8 4-8 4-8-4z"></path><path d="M4 12l8 4 8-4"></path><path d="M4 18l8 4 8-4"></path></svg>` 
        },
        { 
            id: 'origin_area', 
            label: 'Origin Area', 
            route: 'List/Origin Area', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>` 
        },
        { 
            id: 'charge_master', 
            label: 'Charge Master', 
            route: 'List/Charge Master', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>` 
        },
        { 
            id: 'buy_ticket', 
            label: 'Buy Ticket', 
            route: 'List/Buy Ticket', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>` 
        },
        { 
            id: 'lot_event_log', 
            label: 'Lot Event Log', 
            route: 'List/Lot Event Log', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline><path d="M4 12a8 8 0 0 1 8-8 8 8 0 0 1 8 8"></path></svg>` 
        },
        { 
            id: 'lot', 
            label: 'Lot', 
            route: 'List/Lot', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>` 
        },
        { 
            id: 'origin_county', 
            label: 'Origin County', 
            route: 'List/Origin County', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>` 
        },
        { 
            id: 'rail_routing_band', 
            label: 'Rail Routing Band', 
            route: 'List/Rail Routing Band', 
            svgIcon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="16" rx="2"></rect><path d="M4 11h16"></path><path d="M12 3v8"></path><path d="M8 19l-3 3"></path><path d="M16 19l3 3"></path></svg>` 
        }
    ];

    const $primaryNav = $(page.main).find('#holec-primary-items');
    const $target = $(page.main).find('#holec-viewport-container');

    const cleanCSS = `
        :root { --sidebar-width: 0px !important; --page-sidebar-width: 0px !important; }
        .navbar, header.navbar, .sidebar-toggle-btn, .sidebar-collapse-btn { display: none !important; height: 0 !important; }
        .page-head { display: flex !important; padding: 10px 24px !important; border-bottom: 1px solid #ebedf0 !important; background: #ffffff !important; }
        .page-head .page-breadcrumbs { display: none !important; }
        .layout-side-section, .desk-sidebar, .standard-sidebar-section,
        .body-sidebar, .workspace-sidebar, .desk-sidebar-dropdown { display: none !important; width: 0 !important; }
        .page-container, .page-body, .desk-page, .layout-main-section-wrapper,
        .layout-main, .layout-main-section, .workspace-page, .desk-container {
            display: block !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 16px 24px !important;
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
            style: 'width: 100%; height: 100%; border: none; opacity: 0; transition: opacity 0.2s ease-in;'
        });

        $iframe.on('load', function () {
            const frame = this;
            try {
                const frameDoc = frame.contentDocument || frame.contentWindow.document;
                if (frameDoc) {
                    const styleId = 'frappe-clean-iframe-style';
                    let style = frameDoc.getElementById(styleId);
                    if (!style) {
                        style = frameDoc.createElement('style');
                        style.id = styleId;
                        frameDoc.head.appendChild(style);
                    }
                    style.innerHTML = cleanCSS;
                    forceCleanDOM(frameDoc);

                    const observer = new MutationObserver(() => {
                        forceCleanDOM(frameDoc);
                        if (!frameDoc.getElementById(styleId)) {
                            frameDoc.head.appendChild(style);
                        }
                    });
                    observer.observe(frameDoc.body, { childList: true, subtree: true });
                }
            } catch (e) {
                console.warn('Iframe styling access restricted', e);
            }
            $iframe.css('opacity', '1');
        });

        $target.html($iframe);
    }

    // Populate Sidebar items with inline SVGs
    $primaryNav.empty();
    doctypes.forEach((item, idx) => {
        const $btn = $(`
            <li class="tm-primary-item ${idx === 4 ? 'active' : ''}" data-id="${item.id}">
                <span class="primary-icon">${item.svgIcon}</span>
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

    // Default route
    if (doctypes.length > 0) {
        renderIframe(doctypes[4].route);
    }
};