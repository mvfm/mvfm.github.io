import { GameOfLife } from './gol.js';
import { Router } from './router.js';
import { initUI } from './ui.js';
import { track } from './analytics.js';

/**
 * App Configuration & Initialization
 */
const CONFIG = (() => {
    const params = new URLSearchParams(window.location.search);
    const forceRemote = params.get('api') === 'remote';
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    return {
        API_BASE_URL: (isLocal && !forceRemote)
            ? 'http://localhost:8080'
            : 'https://mvfm.pythonanywhere.com',
        MAX_RETRIES: 3,
        RETRY_DELAY_MS: 2000
    };
})();

// Global state for topics
let allTopics = [];
let selectedTopics = new Set();
let topicMnemonics = new Map();
let cartClickHandlerElement = null;
let lastTimelineData = null;

/**
 * Topic Utility Functions
 */
const generateMnemonics = (topics) => {
    topicMnemonics.clear();
    const used = new Set();
    
    // Sort topics for consistency
    const sorted = [...topics].sort();
    
    sorted.forEach(topic => {
        const words = topic.toLowerCase().split(' ');
        let mnemonic = "";

        // 1. Try first letter of each word (if > 1 word)
        if (words.length > 1) {
            mnemonic = words.map(w => w[0]).join('').slice(0, 3);
        }

        // 2. If single word or collision, try first 2 letters
        if (!mnemonic || used.has(mnemonic)) {
            mnemonic = topic.slice(0, 2).toLowerCase();
        }

        // 3. Fallback: try different letters from the topic
        let len = 2;
        while (used.has(mnemonic) && len < topic.length) {
            mnemonic = (topic[0] + topic[++len - 1]).toLowerCase();
        }
        
        // 4. Final: if still duplicate, just append a character (unlikely for 2 letters)
        if (used.has(mnemonic)) {
            mnemonic = topic.slice(0, 2).toLowerCase() + used.size;
        }

        used.add(mnemonic);
        topicMnemonics.set(topic, mnemonic);
    });
};

const getTopicColor = (topicName, isEnabled = true) => {
    // Determine index based on alphabetical order of allTopics
    const index = allTopics.sort().indexOf(topicName);
    if (index === -1) return isEnabled ? 'var(--clr-primary)' : '#cbd5e1';

    // Distribute 20 colors around the wheel (360 / 20 = 18 degrees per step)
    const hue = (index * 18) % 360;
    const saturation = isEnabled ? 70 : 15;
    const lightness = isEnabled ? 45 : 85;
    const alpha = isEnabled ? 1 : 0.6;

    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
};

const getTopicInitials = (topicName) => {
    return topicMnemonics.get(topicName) || topicName.slice(0, 2).toLowerCase();
};

const updateBellState = (data) => {
    const btn = document.getElementById('modal-bell-btn');
    const badge = document.getElementById('modal-bell-badge');
    if (!btn || !badge) return;

    const allSlugs = [
        ...(data.new_events || []).map(e => e.slug),
        ...(data.on_this_day || []).map(e => e.slug)
    ];

    const hasContent = allSlugs.length > 0;
    btn.disabled = !hasContent;

    if (hasContent) {
        const seenRaw = localStorage.getItem('timeline_modal_seen_slugs');
        const seen = seenRaw ? JSON.parse(seenRaw) : [];
        const seenSet = new Set(seen);
        const hasUnseen = allSlugs.some(slug => !seenSet.has(slug));
        badge.hidden = !hasUnseen;
    } else {
        badge.hidden = true;
    }
};

const escHtml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const showTimelineModal = (data, { force = false } = {}) => {
    if (document.getElementById('timeline-modal')) return;
    const today = new Date().toISOString().slice(0, 10);
    if (!force) {
        if (localStorage.getItem('timeline_modal_dismissed') === 'true') return;
        if (localStorage.getItem('timeline_modal_date') === today) return;
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('q') || urlParams.get('topics')) return;
    }

    const hasOnThisDay = data.on_this_day?.length > 0;
    const hasWhatsNew = data.new_events?.length > 0;
    if (!hasOnThisDay && !hasWhatsNew) return;

    const defaultTab = hasOnThisDay ? 'on-this-day' : 'whats-new';

    const buildEntries = (events) => events.map(e => {
        const year = e.date || '';
        const pillsHtml = [...(e.topics || [])].sort().map(t =>
            `<span class="modal-topic-pill" style="background-color:${getTopicColor(t)}" title="${escHtml(t)}">${escHtml(getTopicInitials(t))}</span>`
        ).join('');
        return `<li><button class="modal-entry" data-slug="${escHtml(e.slug)}" data-headline="${escHtml(e.headline)}">` +
            `<span class="modal-entry-date">${escHtml(year)}</span>` +
            `<span class="modal-entry-title">${escHtml(e.headline)}</span>` +
            `<span class="modal-entry-pills">${pillsHtml}</span>` +
            `</button></li>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'timeline-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-card">
            <img class="modal-hero" src="/img/modal-hero.jpg" alt="" aria-hidden="true">
            <button class="modal-close" aria-label="Close">&#x2715;</button>
            <div class="modal-tabs">
                <button class="modal-tab${defaultTab === 'on-this-day' ? ' active' : ''}${!hasOnThisDay ? ' disabled' : ''}"
                    data-tab="on-this-day"${!hasOnThisDay ? ' disabled' : ''}>On This Day</button>
                <button class="modal-tab${defaultTab === 'whats-new' ? ' active' : ''}${!hasWhatsNew ? ' disabled' : ''}"
                    data-tab="whats-new"${!hasWhatsNew ? ' disabled' : ''}>What's New</button>
            </div>
            <div class="modal-tab-content${defaultTab === 'on-this-day' ? ' active' : ''}" id="modal-panel-on-this-day">
                <ul class="modal-entry-list">${hasOnThisDay ? buildEntries(data.on_this_day) : ''}</ul>
            </div>
            <div class="modal-tab-content${defaultTab === 'whats-new' ? ' active' : ''}" id="modal-panel-whats-new">
                <ul class="modal-entry-list">${hasWhatsNew ? buildEntries(data.new_events) : ''}</ul>
            </div>
            <div class="modal-footer">
                <label class="modal-dismiss-label">
                    <input type="checkbox" id="modal-dont-show-again">
                    Don't show again
                </label>
            </div>
        </div>`;

    const panel = document.getElementById('contentPanel');
    if (!panel) return;
    panel.appendChild(modal);

    // Mark current slugs as seen and refresh bell badge
    const seenSlugs = [
        ...(data.new_events || []).map(e => e.slug),
        ...(data.on_this_day || []).map(e => e.slug)
    ];
    localStorage.setItem('timeline_modal_seen_slugs', JSON.stringify(seenSlugs));
    updateBellState(data);

    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('modal-visible')));

    const onKeydown = (e) => { if (e.key === 'Escape') dismiss(); };

    const dismiss = () => {
        document.removeEventListener('keydown', onKeydown);
        const permanent = document.getElementById('modal-dont-show-again')?.checked;
        localStorage.setItem('timeline_modal_date', today);
        if (permanent) localStorage.setItem('timeline_modal_dismissed', 'true');
        modal.classList.remove('modal-visible');
        setTimeout(() => modal.remove(), 300);
    };

    document.addEventListener('keydown', onKeydown);

    modal.querySelector('.modal-close').addEventListener('click', dismiss);
    modal.addEventListener('click', (e) => { if (e.target === modal) dismiss(); });

    const trackTab = (tabId) => track('timeline_modal_tab_view', { tab: tabId.replace(/-/g, '_') });

    trackTab(defaultTab);

    modal.querySelectorAll('.modal-tab:not([disabled])').forEach(tab => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            modal.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`modal-panel-${tab.dataset.tab}`)?.classList.add('active');
            trackTab(tab.dataset.tab);
        });
    });

    modal.querySelectorAll('.modal-entry').forEach(btn => {
        btn.addEventListener('click', () => {
            const { slug, headline } = btn.dataset;
            const panelId = btn.closest('.modal-tab-content')?.id;
            const eventName = panelId === 'modal-panel-on-this-day'
                ? 'timeline_modal_on_this_day_click'
                : 'timeline_modal_new_event_click';
            track(eventName, { event_id: slug, event_title: headline });
            dismiss();
            // Allow modal CSS transition to start before navigating
            setTimeout(() => {
                window.timeline?.goToId?.(slug);
            }, 50);
        });
    });
};

const aiRouteOnLoad = async () => {
    // The router replaces the entire panel innerHTML on each navigation, so the
    // old #timeline-embed (and its listeners) is gone. Reset the guard so that
    // handlers are re-attached to the freshly-created element.
    // NOTE: do not reset cartClickHandlerElement here — the check below compares
    // the actual element reference, so it naturally handles both router-navigation
    // (new element) and search reloads (same element, skip re-registration).
    const embed = document.getElementById('timeline-embed');
    const urlParams = new URLSearchParams(window.location.search);
    
    // 1. Initial State Restoration (URL takes precedence, then localStorage)
    let query = urlParams.get('q');
    let topicsParam = urlParams.get('topics');
    let currentHash = window.location.hash;

    let needsUrlUpdate = false;
    const newUrl = new URL(window.location.href);

    // Restore search/topics if missing from URL
    if (!query && !topicsParam) {
        const savedQ = localStorage.getItem('timeline_q');
        const savedTopics = localStorage.getItem('timeline_topics');
        
        if (savedQ || savedTopics) {
            query = savedQ;
            topicsParam = savedTopics;
            if (query) newUrl.searchParams.set('q', query);
            if (topicsParam) newUrl.searchParams.set('topics', topicsParam);
            needsUrlUpdate = true;
        }
    }

    // Restore hash if missing from URL
    if (!currentHash) {
        const savedHash = localStorage.getItem('timeline_hash');
        if (savedHash) {
            newUrl.hash = savedHash;
            needsUrlUpdate = true;
        }
    }

    if (needsUrlUpdate) {
        window.history.replaceState({}, '', newUrl);
    }

    // Update selectedTopics based on restored/URL state
    if (topicsParam) {
        selectedTopics = new Set(topicsParam.split(',').filter(Boolean));
    } else {
        selectedTopics = new Set();
    }

    const showLoading = (message) => {
        if (embed) {
            embed.innerHTML = `
                <div class="spinner-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 200px; gap: 1.5rem; font-family: system-ui, -apple-system, sans-serif;">
                    <div class="spinner" style="width: 48px; height: 48px; border: 3px solid rgba(27, 170, 255, 0.2); border-radius: 50%; border-top-color: var(--clr-accent); animation: spin 0.8s linear infinite;"></div>
                    <p class="loading-text" style="color: var(--clr-accent); font-weight: 600; text-align: center; margin: 0; font-family: inherit;">${message}</p>
                </div>`;
        }
    };

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            const baseMessage = query ? `Searching for "${query}"...` : `Loading timeline data...`;
            const message = attempt > 1
                ? `Retrying (${attempt} of ${CONFIG.MAX_RETRIES})...`
                : baseMessage;

            showLoading(message);

            if (attempt > 1) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS));
            }

            const queryUrl = new URL(`${CONFIG.API_BASE_URL}/timeline`);
            if (query) {
                queryUrl.searchParams.append('q', query);
            }
            if (topicsParam) {
                queryUrl.searchParams.append('topics', topicsParam);
            }

            console.log(`Attempt ${attempt}: Fetching timeline data from ${queryUrl}...`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const response = await fetch(queryUrl, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();

            // Track timeline search analytics
            if (query) track('timeline_search', { query, result_count: data.events?.length || 0 });

            // Inject structured data (JSON-LD) for Googlebot
            if (data.events?.length > 0) {
                const itemList = {
                    '@context': 'https://schema.org',
                    '@type': 'ItemList',
                    name: 'AI History Timeline',
                    description: 'An interactive timeline of major events in the history of Artificial Intelligence, curated by Marcus Vinicius Freitas Margarites.',
                    author: { '@type': 'Person', name: 'Marcus Vinicius Freitas Margarites' },
                    itemListElement: data.events.map((event, i) => {
                        const d = event.start_date;
                        const startDate = d ? [d.year, d.month, d.day].filter(Boolean).join('-') : undefined;
                        const item = { '@type': 'Event', name: event.text?.headline || '' };
                        if (startDate) item.startDate = startDate;
                        return { '@type': 'ListItem', position: i + 1, item };
                    })
                };
                let ld = document.getElementById('ld-timeline');
                if (!ld) {
                    ld = document.createElement('script');
                    ld.type = 'application/ld+json';
                    ld.id = 'ld-timeline';
                    document.head.appendChild(ld);
                }
                ld.textContent = JSON.stringify(itemList);
            }

            // Store topics globally for color consistency
            if (data.topics) {
                allTopics = data.topics;
                generateMnemonics(allTopics);
            }

            // Inject topic labels and purchase link cart icon into event data
            if (data.events) {
                data.events.forEach(event => {
                    if (!event.text) event.text = { text: "" };

                    if (event.purchase_links && event.purchase_links.length > 0) {
                        const linksHtml = event.purchase_links.map(l =>
                            `<a class="purchase-link" href="${l.url}" target="_new">${l.label}</a>`
                        ).join('');
                        const cartHtml = `
                            <div class="purchase-links-container">
                                <button class="cart-btn" aria-label="Purchase links" title="Purchase links" data-event-id="${event.unique_id}" data-event-title="${event.text?.headline || ''}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                                         fill="none" stroke="currentColor" stroke-width="2"
                                         stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                                    </svg>
                                </button>
                                <div class="purchase-dropdown">${linksHtml}</div>
                            </div>`;
                        event.text.text = cartHtml + (event.text.text || "");
                    }

                    if (event.topics && event.topics.length > 0) {
                        const labelsHtml = `
                            <div class="topic-labels-container">
                                ${[...event.topics].sort().map(t => `
                                    <div class="event-topic-label"
                                         style="background-color: ${getTopicColor(t)}"
                                         title="${t}">
                                        ${getTopicInitials(t)}
                                    </div>
                                `).join('')}
                            </div>`;
                        event.text.text = labelsHtml + (event.text.text || "");
                    }
                });
            }

            // Success: Initialize TimelineJS or show empty message
            setTimeout(() => {
                if (data.events && data.events.length > 0) {
                    if (window.TL) {
                        window.timeline = new TL.Timeline('timeline-embed', data, {
                            theme_color: "#b94d97",
                            initial_zoom: 2,
                            hash_bookmark: true,
                            timenav_position: "bottom",
                            font: "default"
                        });

                        // RELOCATE LABELS: Move labels/cart to be children of .tl-slide to allow true corner pinning
                        const relocateContainer = (slide, selector) => {
                            const el = slide.querySelector(`${selector}:not([data-relocated="true"])`);
                            if (el && el.parentElement.classList.contains('tl-text-content')) {
                                slide.prepend(el);
                                el.setAttribute('data-relocated', 'true');
                                requestAnimationFrame(() => { el.style.opacity = '1'; });
                            }
                        };

                        const relocateLabels = () => {
                            document.querySelectorAll('.tl-slide').forEach(slide => {
                                relocateContainer(slide, '.topic-labels-container');
                                relocateContainer(slide, '.purchase-links-container');
                            });
                        };

                        // Cart icon click handler (event delegation — added once per element)
                        if (cartClickHandlerElement !== document.getElementById('timeline-embed')) {
                        cartClickHandlerElement = document.getElementById('timeline-embed');
                        document.getElementById('timeline-embed').addEventListener('click', (e) => {
                            const btn = e.target.closest('.cart-btn');
                            if (!btn) {
                                document.querySelectorAll('.purchase-dropdown.open')
                                    .forEach(d => d.classList.remove('open'));
                                return;
                            }
                            e.stopPropagation();

                            // Track timeline_purchase_click
                            const eventId = btn.getAttribute('data-event-id');
                            const eventTitle = btn.getAttribute('data-event-title');
                            track('timeline_purchase_click', { event_id: eventId, event_title: eventTitle });

                            const dropdown = btn.nextElementSibling;
                            const isOpen = dropdown.classList.contains('open');
                            document.querySelectorAll('.purchase-dropdown.open')
                                .forEach(d => d.classList.remove('open'));
                            if (!isOpen) dropdown.classList.add('open');
                        });

                        // Purchase link click handler
                        document.getElementById('timeline-embed').addEventListener('click', (e) => {
                            const link = e.target.closest('.purchase-link');
                            if (!link) return;

                            // Find the cart button to get event_id and event_title
                            const cartBtn = link.closest('.purchase-dropdown').previousElementSibling;
                            const eventId = cartBtn.getAttribute('data-event-id');
                            const eventTitle = cartBtn.getAttribute('data-event-title');
                            const optionTitle = link.textContent;
                            const optionUrl = link.href; // DOM property resolves relative URLs to absolute

                            // Track timeline_purchase_option_click
                            track('timeline_purchase_option_click', {
                                event_id: eventId,
                                event_title: eventTitle,
                                option_title: optionTitle,
                                option_url: optionUrl
                            });

                            // Close open dropdowns
                            document.querySelectorAll('.purchase-dropdown.open').forEach(d => d.classList.remove('open'));
                        });
                        } // end cartClickHandlerAdded guard

                        // Initial relocation attempts
                        setTimeout(relocateLabels, 100);
                        setTimeout(relocateLabels, 1000);

                        lastTimelineData = data;
                        updateBellState(data);
                        showTimelineModal(data);

                        // Flag to prevent initial "change" events from overwriting the restored hash
                        let isTimelineInitialized = false;

                        // Dwell timer for timeline event view tracking
                        let dwellTimer = null;

                        window.timeline.on('change', (e) => {
                            setTimeout(relocateLabels, 50);

                            // Cancel any existing dwell timer
                            clearTimeout(dwellTimer);

                            // Start a new 500ms dwell timer
                            dwellTimer = setTimeout(() => {
                                const slide = window.timeline.getCurrentSlide?.();
                                const eventId = String(e.unique_id || slide?.data?.unique_id || '');
                                const eventTitle = slide?.data?.text?.headline || '';
                                if (eventId) track('timeline_event_view', { event_id: eventId, event_title: eventTitle });
                            }, 500);

                            if (isTimelineInitialized) {
                                // Persist current unique_id as hash position
                                // We use the event's unique_id if available, otherwise fallback to hash
                                const newId = e.unique_id || (window.timeline.getCurrentSlide()?.data?.unique_id);
                                if (newId) {
                                    const newHash = `#event-${newId}`;
                                    localStorage.setItem('timeline_hash', newHash);
                                }
                            }
                        });

                        // Enable persistence after a short delay to allow TimelineJS to "settle" on the bookmark
                        setTimeout(() => {
                            isTimelineInitialized = true;
                        }, 1500);
                    }
                } else {
                    // Handle empty results gracefully
                    if (embed) {
                        embed.innerHTML = `
                            <div class="spinner-container">
                                <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--clr-text-muted)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;">
                                    <circle cx="11" cy="11" r="8"></circle>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                    <line x1="11" y1="8" x2="11" y2="12"></line>
                                    <line x1="11" y1="14" x2="11.01" y2="14"></line>
                                </svg>
                                <p class="loading-text" style="color: var(--clr-text-muted);">No matching events found.</p>
                                <button id="empty-clear-search" class="btn-secondary" style="margin-top: 1rem;">View all events</button>
                            </div>`;

                        document.getElementById('empty-clear-search')?.addEventListener('click', () => {
                            const input = document.getElementById('search-input');
                            if (input) {
                                input.value = '';
                                const url = new URL(window.location.href);
                                url.searchParams.delete('q');
                                window.history.pushState({}, '', url);
                                aiRouteOnLoad();
                            }
                        });
                    }
                }
                // Initialize Search UI behaviors
                initTimelineSearch();
            }, 50);

            return; // Exit loop on success

        } catch (error) {
            console.error(`Attempt ${attempt} failed:`, error);

            if (attempt === CONFIG.MAX_RETRIES) {
                const isTimeout = error.name === 'AbortError';
                const errorMsg = isTimeout
                    ? `Request timed out after 60s. The AIAPI might still be starting up.`
                    : `${error.message}`;

                if (embed) {
                    embed.innerHTML = `
                        <div style="padding: 2.5rem; color: #ff6b6b; text-align: center; border: 1px dashed #ff6b6b; border-radius: 12px; margin: 1rem;">
                            <h3 style="margin-top:0">Failed to load timeline</h3>
                            <p>${errorMsg}</p>
                            <p style="font-size: 0.85rem; opacity: 0.8;">
                                URL: <code>${CONFIG.API_BASE_URL}/timeline</code><br>
                                ${error.name}: Ensure the AIAPI is reachable.
                            </p>
                            <button onclick="location.reload()" style="background: transparent; border: 1px solid #ff6b6b; color: #ff6b6b; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; margin-top: 1rem;">Retry Page</button>
                        </div>`;
                }
            }
        }
    }
};

/**
 * Initialize Timeline Search UI interactions
 */
const initTimelineSearch = () => {
    // This will be defined inside initTimelineSearch but we need to call it from outside
    window.refreshTopicFilters = () => {}; 

    const toggle = document.getElementById('search-toggle');
    const container = document.getElementById('search-container');
    const input = document.getElementById('search-input');
    const submit = document.getElementById('search-submit');
    const cancel = document.getElementById('search-cancel');

    if (!toggle || !container || !input || !submit || !cancel) return;

    // Prevent double initialization but allow refreshing filters
    if (toggle.dataset.initialized) {
        if (window.refreshTopicFilters) window.refreshTopicFilters();
        return;
    }
    toggle.dataset.initialized = "true";

    // Set initial value from URL
    const urlParams = new URL(window.location.href).searchParams;
    if (urlParams.has('q')) {
        input.value = urlParams.get('q');
        container.classList.add('show');
    }
    
    // Initial sync of selectedTopics from URL params
    if (urlParams.has('topics')) {
        selectedTopics = new Set(urlParams.get('topics').split(',').filter(Boolean));
    }
    
    submit.disabled = !input.value.trim() && selectedTopics.size === 0;

    const renderTopicFilters = () => {
        const filterContainer = document.getElementById('topic-filter-container');
        if (!filterContainer) return;

        filterContainer.innerHTML = '';
        if (allTopics.length === 0) {
            filterContainer.style.display = 'none';
            return;
        }
        filterContainer.style.display = 'flex';

        allTopics.sort().forEach(topic => {
            const isSelected = selectedTopics.has(topic);
            const pill = document.createElement('div');
            pill.className = `topic-pill ${isSelected ? 'selected' : ''}`;
            pill.textContent = topic;
            pill.style.backgroundColor = getTopicColor(topic, isSelected);
            pill.style.color = isSelected ? 'white' : 'var(--clr-text-muted)';
            pill.style.borderColor = isSelected ? 'transparent' : getTopicColor(topic, false);

            pill.addEventListener('click', () => {
                if (selectedTopics.has(topic)) {
                    selectedTopics.delete(topic);
                } else {
                    selectedTopics.add(topic);
                }
                track('timeline_topic_filter', { topic, active_topics: Array.from(selectedTopics) });
                renderTopicFilters();
                submit.disabled = !input.value.trim() && selectedTopics.size === 0;
            });

            filterContainer.appendChild(pill);
        });
    };

    window.refreshTopicFilters = renderTopicFilters;
    renderTopicFilters();

    const toggleSearch = () => {
        const isShowing = container.classList.toggle('show');
        if (isShowing) input.focus();
    };

    const performSearch = () => {
        const query = input.value.trim();
        const topics = Array.from(selectedTopics).join(',');
        const url = new URL(window.location.href);
        
        // Always clear hash when performing a NEW search
        url.hash = '';
        localStorage.removeItem('timeline_hash');

        if (query) {
            url.searchParams.set('q', query);
            localStorage.setItem('timeline_q', query);
        } else {
            url.searchParams.delete('q');
            localStorage.removeItem('timeline_q');
        }

        if (topics) {
            url.searchParams.set('topics', topics);
            localStorage.setItem('timeline_topics', topics);
        } else {
            url.searchParams.delete('topics');
            localStorage.removeItem('timeline_topics');
        }

        window.history.pushState({}, '', url);
        aiRouteOnLoad();
    };

    const clearSearch = () => {
        input.value = '';
        selectedTopics.clear();
        container.classList.remove('show');

        localStorage.removeItem('timeline_q');
        localStorage.removeItem('timeline_topics');

        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        url.searchParams.delete('topics');
        // Preserve hash so the user stays on the current slide

        window.history.pushState({}, '', url);
        aiRouteOnLoad();
    };

    toggle.addEventListener('click', toggleSearch);
    cancel.addEventListener('click', clearSearch);
    submit.addEventListener('click', performSearch);

    // No debounce needed here: this listener only toggles submit.disabled.
    // Search (and analytics tracking) only fires on explicit submit — button click
    // or Enter keydown — so there is no real-time search loop to debounce.
    input.addEventListener('input', () => {
        submit.disabled = !input.value.trim() && selectedTopics.size === 0;
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !submit.disabled) {
            performSearch();
        } else if (e.key === 'Escape') {
            container.classList.remove('show');
        }
    });

    const bellBtn = document.getElementById('modal-bell-btn');
    if (bellBtn) {
        bellBtn.addEventListener('click', () => {
            if (!lastTimelineData) return;
            track('timeline_modal_reopen');
            showTimelineModal(lastTimelineData, { force: true });
        });
    }
};

const resumeRouteOnLoad = async () => {
    const resumeLink = document.querySelector('a[href="/pdf/resume.pdf"]');
    if (resumeLink) {
        resumeLink.addEventListener('click', () => track('resume_download_click'));
    }

    const container = document.getElementById('resume-quip');
    if (!container) return;
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/quip`);
        if (!response.ok) return;
        const data = await response.json();
        if (!data.text) return;
        const block = document.createElement('div');
        block.className = 'quip-block';
        const p = document.createElement('p');
        p.textContent = data.text;
        block.appendChild(p);
        container.appendChild(block);
    } catch {
        // Silent failure — quip is decorative
    }
};

const contactRouteOnLoad = () => {
    const linkedInLink = document.querySelector('a[href="https://www.linkedin.com/in/marcusmargarites/"]');
    if (linkedInLink) {
        linkedInLink.addEventListener('click', () => track('contact_linkedin_click'));
    }
};

const routes = {
    home: { title: 'Welcome', template: 'tpl-home' },
    contact: { title: 'Contact', template: 'tpl-contact', onLoad: contactRouteOnLoad },
    resume: { title: 'Resume', template: 'tpl-resume', onLoad: resumeRouteOnLoad },
    ai: { title: 'AI', template: 'tpl-ai', onLoad: aiRouteOnLoad }
};

// Start application
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize UI global behaviors
    initUI();

    // 2. Initialize Game of Life engine
    new GameOfLife('golCanvas', {
        gen: 'genDigits',
        alive: 'aliveDigits',
        total: 'totalDigits',
        occ: 'occDigits'
    });

    // 3. Initialize Router
    new Router(routes);
});
