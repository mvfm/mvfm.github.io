import { GameOfLife } from './gol.js';
import { Router } from './router.js';
import { initUI } from './ui.js';
import { track } from './analytics.js';
import { injectShell } from './shell.js';
import { API_BASE_URL } from './config.js';
import { getTopicColor, generateMnemonics, getTopicInitials } from './topics.js';
import { findingsRouteOnLoad } from './findings.js';
import { AITimeline } from './timeline/timeline.js';

// Mirrors TimelineJS slugify() exactly — keep in sync with app/util.py
function slugify(str) {
    if (!str) return '';
    const from = "ãàáäâẽèéëêìíïîõòóöôùúüûñç·/_,:;";
    const to   = "aaaaaeeeeeiiiiooooouuuunc------";
    str = str.trim().toLowerCase();
    for (let i = 0; i < from.length; i++) {
        str = str.replaceAll(from[i], to[i]);
    }
    str = str.replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    if (/^[0-9]/.test(str)) str = '_' + str;
    return str;
}

// Allowlist sanitiser for /timeline event body HTML (API only ever sends b/i/p/a/br).
function sanitizeTimelineText(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const ALLOWED = new Set(['B', 'I', 'P', 'A', 'BR', 'EM', 'STRONG']);
  tpl.content.querySelectorAll('*').forEach(node => {
    if (!ALLOWED.has(node.tagName)) { node.replaceWith(...node.childNodes); return; }
    [...node.attributes].forEach(attr => {
      if (node.tagName === 'A' && (attr.name === 'href' || attr.name === 'target')) return;
      node.removeAttribute(attr.name);
    });
  });
  return tpl.innerHTML;
}

/**
 * App Configuration & Initialization
 */
const CONFIG = {
    API_BASE_URL,
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 2000
};

// Global state for topics
let allTopics = [];
let selectedTopics = new Set();
let lastTimelineData = null;
let _modalCreating = false;

// --- AITimeline lifecycle ----------------------------------------------------
// AITimeline owns all its own DOM and listeners; destroy() tears them down.
const destroyTimeline = () => {
    window.timeline?.destroy?.();
    window.timeline = null;
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
    if (document.getElementById('timeline-modal') || _modalCreating) return;
    const today = new Date().toISOString().slice(0, 10);
    if (!force) {
        if (localStorage.getItem('timeline_modal_dismissed') === 'true') return;
        if (localStorage.getItem('timeline_modal_date') === today) return;
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('q') || urlParams.get('topics') || urlParams.get('slugs')) return;
    }

    const hasOnThisDay = data.on_this_day?.length > 0;
    const hasWhatsNew = data.new_events?.length > 0;
    if (!hasOnThisDay && !hasWhatsNew) return;

    _modalCreating = true;

    const defaultTab = hasOnThisDay ? 'on-this-day' : 'whats-new';

    const buildEntries = (events) => events.map(e => {
        const year = e.date || '';
        const pillsHtml = [...(e.topics || [])].sort().map(t =>
            `<span class="modal-topic-pill" style="background-color:${getTopicColor(t, allTopics)}" title="${escHtml(t)}">${escHtml(getTopicInitials(t))}</span>`
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
    if (!panel) { _modalCreating = false; return; }
    panel.appendChild(modal);
    _modalCreating = false;

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
        setTimeout(() => { modal.remove(); _modalCreating = false; }, 300);
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
                history.replaceState(null, '', `#event-${slug}`);
            }, 50);
        });
    });
};

const aiRouteOnLoad = async () => {
    // Tear down any previous timeline instance. On router navigation this is a
    // no-op (onUnload already ran); on a search / topic-filter reload this call
    // arrives here directly and is the only teardown point.
    destroyTimeline();

    const embed = document.getElementById('timeline-embed');
    const urlParams = new URLSearchParams(window.location.search);

    // 1. Initial State Restoration (URL takes precedence, then localStorage)
    let query = urlParams.get('q');
    let topicsParam = urlParams.get('topics');
    let slugsParam = urlParams.get('slugs');
    let currentHash = window.location.hash;

    // Resolve insights=<term> in query param (e.g. from article CTA links)
    const insightsMatch = query && query.match(/(?:^|\s)insights=(\S+)/i);
    if (insightsMatch) {
        try {
            const manifestRes = await fetch('/insights/manifest.json');
            if (manifestRes.ok) {
                const manifest = await manifestRes.json();
                const term = insightsMatch[1].toLowerCase();
                const article = manifest.find(a =>
                    a.slug.toLowerCase().includes(term) ||
                    a.title.toLowerCase().includes(term)
                );
                if (article?.referenced_events?.length) {
                    slugsParam = article.referenced_events.join(',');
                    query = query.replace(insightsMatch[0], '').trim() || null;
                }
            }
        } catch (e) {
            console.warn('Could not resolve insights= term in URL:', e);
        }
    }

    let needsUrlUpdate = false;
    const newUrl = new URL(window.location.href);

    // Restore search/topics if missing from URL — but skip if the URL targets a
    // specific event via hash: restoring a saved query could exclude that event.
    const hasEventHash = /^#event-/.test(currentHash);
    if (!query && !topicsParam && !slugsParam && !hasEventHash) {
        const savedQ = localStorage.getItem('timeline_q');
        const savedTopics = localStorage.getItem('timeline_topics');
        const savedSlugs = localStorage.getItem('timeline_slugs');

        if (savedQ || savedTopics || savedSlugs) {
            query = savedQ;
            topicsParam = savedTopics;
            slugsParam = savedSlugs;
            if (query) newUrl.searchParams.set('q', query);
            if (topicsParam) newUrl.searchParams.set('topics', topicsParam);
            if (slugsParam) newUrl.searchParams.set('slugs', slugsParam);
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

    // Build article→event cross-reference map from insights manifest
    let articlesByEvent = new Map();
    try {
        const manifestRes = await fetch('/insights/manifest.json');
        if (manifestRes.ok) {
            const manifest = await manifestRes.json();
            manifest.forEach(article => {
                (article.referenced_events || []).forEach(eventId => {
                    if (!articlesByEvent.has(eventId)) articlesByEvent.set(eventId, []);
                    articlesByEvent.get(eventId).push({ slug: article.slug, title: article.title });
                });
            });
        }
    } catch (e) {
        console.warn('Could not load insights manifest:', e);
    }

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            const baseMessage = query ? `Searching for "${query}"...` : slugsParam ? `Loading related events...` : `Loading timeline data...`;
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
            if (slugsParam) {
                queryUrl.searchParams.append('slugs', slugsParam);
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

            // Success: Initialize the timeline or show empty message
            setTimeout(() => {
                if (data.events && data.events.length > 0) {
                    window.timeline = new AITimeline(embed, {
                        colorForTopic: t => getTopicColor(t, allTopics),
                        initialsForTopic: t => getTopicInitials(t),
                        insightArticlesFor: slug => articlesByEvent.get(slug) || [],
                        sanitizeText: sanitizeTimelineText,
                        track,
                        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
                        slugify,
                        onCartClick: (ev) => {
                            const btn = ev.target.closest('.cart-btn');
                            track('timeline_purchase_click', {
                                event_id: btn?.dataset.eventId, event_title: btn?.dataset.eventTitle,
                            });
                        },
                        onCartOptionClick: (link) => {
                            const btn = link.closest('.ait-cart')?.querySelector('.cart-btn');
                            track('timeline_purchase_option_click', {
                                event_id: btn?.dataset.eventId, event_title: btn?.dataset.eventTitle,
                                option_title: link.textContent, option_url: link.href,
                            });
                        },
                        onInsightClick: (chip) => {
                            track('timeline_insight_click', {
                                event_id: chip.dataset.eventId, event_title: chip.dataset.eventTitle,
                                article_slug: chip.dataset.articleSlug, article_title: chip.dataset.articleTitle,
                            });
                        },
                        onTextLinkClick: (link) => {
                            const cur = window.timeline.getCurrentSlide?.();
                            track('timeline_text_link_click', {
                                event_id: String(cur?.data?.unique_id || ''),
                                event_title: cur?.data?.text?.headline || '',
                                link_label: link.textContent.trim(), link_url: link.href,
                            });
                        },
                    });

                    window.timeline.setEvents(data);

                    // Deep-link: jump to #event-<slug> on load. goToId is synchronous
                    // and safe to call immediately; keep one microtask retry for the
                    // case where the hash was set by a restore just above.
                    const _hashSlug = (window.location.hash.match(/^#event-(.+)$/) || [])[1];
                    if (_hashSlug) {
                        window.timeline.goToId(_hashSlug);
                        queueMicrotask(() => window.timeline?.goToId?.(_hashSlug));
                    }

                    lastTimelineData = data;
                    updateBellState(data);
                    showTimelineModal(data);

                    let isTimelineInitialized = false;
                    let dwellTimer = null;
                    let _writeHashTimer = null;
                    const writeHash = (newId) => {
                        clearTimeout(_writeHashTimer);
                        _writeHashTimer = setTimeout(() => {
                            const newHash = `#event-${newId}`;
                            localStorage.setItem('timeline_hash', newHash);
                            history.replaceState(null, '', newHash);
                        }, 150);
                    };
                    window.timeline.on('change', (e) => {
                        clearTimeout(dwellTimer);
                        dwellTimer = setTimeout(() => {
                            if (e.unique_id) track('timeline_event_view', { event_id: e.unique_id, event_title: e.text?.headline || '' });
                        }, 500);
                        if (isTimelineInitialized && e.unique_id) writeHash(e.unique_id);
                    });
                    setTimeout(() => { isTimelineInitialized = true; }, 1500);
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
                                url.searchParams.delete('slugs');
                                localStorage.removeItem('timeline_q');
                                localStorage.removeItem('timeline_slugs');
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
            pill.style.backgroundColor = getTopicColor(topic, allTopics, isSelected);
            pill.style.color = isSelected ? 'white' : 'var(--clr-text-muted)';
            pill.style.borderColor = isSelected ? 'transparent' : getTopicColor(topic, allTopics, false);

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

    const performSearch = async () => {
        const rawQuery = input.value.trim();
        const topics = Array.from(selectedTopics).join(',');
        const url = new URL(window.location.href);

        // Always clear hash when performing a NEW search
        url.hash = '';
        localStorage.removeItem('timeline_hash');

        // Detect insights=<term> token and resolve to slugs
        const insightsMatch = rawQuery.match(/(?:^|\s)insights=(\S+)/i);
        let resolvedSlugs = null;
        let remainingQuery = rawQuery;

        if (insightsMatch) {
            const term = insightsMatch[1].toLowerCase();
            remainingQuery = rawQuery.replace(insightsMatch[0], '').trim();
            try {
                const manifestRes = await fetch('/insights/manifest.json');
                if (manifestRes.ok) {
                    const manifest = await manifestRes.json();
                    const article = manifest.find(a =>
                        a.slug.toLowerCase().includes(term) ||
                        a.title.toLowerCase().includes(term)
                    );
                    if (article?.referenced_events?.length) {
                        resolvedSlugs = article.referenced_events.join(',');
                    }
                }
            } catch (e) {
                console.warn('Could not resolve insights= term:', e);
            }
        }

        if (resolvedSlugs) {
            url.searchParams.set('slugs', resolvedSlugs);
            localStorage.setItem('timeline_slugs', resolvedSlugs);
        } else {
            url.searchParams.delete('slugs');
            localStorage.removeItem('timeline_slugs');
        }

        const query = resolvedSlugs ? remainingQuery : rawQuery;

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
        localStorage.removeItem('timeline_slugs');

        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        url.searchParams.delete('topics');
        url.searchParams.delete('slugs');
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

    const firstBtn = document.getElementById('timeline-first');
    if (firstBtn && !firstBtn.dataset.listenerAttached) {
        firstBtn.dataset.listenerAttached = 'true';
        firstBtn.addEventListener('click', () => {
            window.timeline?.first?.();
            track('timeline_jump_edge', { edge: 'first' });
        });
    }

    const lastBtn = document.getElementById('timeline-last');
    if (lastBtn && !lastBtn.dataset.listenerAttached) {
        lastBtn.dataset.listenerAttached = 'true';
        lastBtn.addEventListener('click', () => {
            window.timeline?.last?.();
            track('timeline_jump_edge', { edge: 'last' });
        });
    }

    const bellBtn = document.getElementById('modal-bell-btn');
    if (bellBtn && !bellBtn.dataset.listenerAttached) {
        bellBtn.dataset.listenerAttached = 'true';
        bellBtn.addEventListener('click', () => {
            if (!lastTimelineData) return;
            track('timeline_modal_reopen');
            showTimelineModal(lastTimelineData, { force: true });
        });
    }

    const twitterLink = document.querySelector('a[href*="x.com/aihtimeline"]');
    if (twitterLink && !twitterLink.dataset.listenerAttached) {
        twitterLink.dataset.listenerAttached = 'true';
        twitterLink.addEventListener('click', () => {
            track('contact_twitter_click');
        });
    }
};

const insightsArticleOnLoad = () => {
    const slug = window.__FEATURE_SLUG__;
    if (slug) track('insights_entry_view', { slug });
};


const insightsRouteOnLoad = async () => {
    const grid = document.getElementById('insights-grid');
    if (!grid) return;

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length < 2) return parts[0];
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    };

    try {
        const response = await fetch('/insights/manifest.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const articles = await response.json();

        if (!articles.length) {
            grid.innerHTML = '<p class="loading-text" style="color: var(--clr-text-muted);">No articles yet. Check back soon.</p>';
            return;
        }

        grid.innerHTML = articles.map(article => `
            <a class="insight-card" href="/insights/${escHtml(article.slug)}.html" data-slug="${escHtml(article.slug)}">
                <span class="insight-card-date">${escHtml(formatDate(article.date))}</span>
                <h3 class="insight-card-title">${escHtml(article.title)}</h3>
                <p class="insight-card-desc">${escHtml(article.description)}</p>
            </a>
        `).join('');

    } catch (err) {
        console.error('Failed to load insights manifest:', err);
        grid.innerHTML = '<p class="loading-text" style="color: #ff6b6b;">Failed to load articles.</p>';
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
    home: {
        title: 'Marcus Vinicius Freitas Margarites — Systems Engineer & AI Researcher',
        description: 'Senior software engineer and solution designer with a long track record of modernizing enterprise systems across multiple generations of technology.',
        canonicalUrl: 'https://mvfm.digital/',
        template: 'tpl-home'
    },
    contact: {
        title: 'Contact — Marcus Vinicius Freitas Margarites',
        description: 'Get in touch with Marcus Vinicius Freitas Margarites, senior software engineer and solution designer, for professional opportunities and collaboration.',
        canonicalUrl: 'https://mvfm.digital/contact',
        template: 'tpl-contact',
        onLoad: contactRouteOnLoad
    },
    resume: {
        title: 'Résumé — Marcus Vinicius Freitas Margarites',
        description: 'Senior software engineer and solution designer with nearly four decades of experience in architecture, cloud, AI-enabled solutions, and technical leadership.',
        canonicalUrl: 'https://mvfm.digital/resume',
        template: 'tpl-resume',
        onLoad: resumeRouteOnLoad
    },
    ai: {
        title: 'AI History Timeline — Marcus Vinicius Freitas Margarites',
        description: 'From Turing\'s question to today\'s transformers: The pivotal moments that shaped modern AI, in an interactive timeline.',
        canonicalUrl: 'https://mvfm.digital/ai',
        template: 'tpl-ai',
        onLoad: aiRouteOnLoad,
        onUnload: destroyTimeline
    },
    insights: {
        title: 'Insights — Marcus Vinicius Freitas Margarites',
        description: 'Deep dives into AI history, algorithms, and ideas — written by Marcus Vinicius Freitas Margarites.',
        canonicalUrl: 'https://mvfm.digital/insights',
        template: 'tpl-insights',
        onLoad: insightsRouteOnLoad
    },
    findings: {
        title: 'Findings — Marcus Vinicius Freitas Margarites',
        description: 'A curated web of links on AI, its history, and its open problems — with a graph connecting them to the timeline and to Insights.',
        canonicalUrl: 'https://mvfm.digital/findings',
        template: 'tpl-findings',
        onLoad: findingsRouteOnLoad
    },
    'insights-article': {
        get title() { return document.title || 'Insights — mvfm.digital'; },
        get description() { return document.querySelector('meta[name="description"]')?.content || ''; },
        get canonicalUrl() { return document.querySelector('link[rel="canonical"]')?.getAttribute('href') || 'https://mvfm.digital/insights'; },
        template: 'tpl-feature',
        onLoad: insightsArticleOnLoad
    }
};

// Start application
document.addEventListener('DOMContentLoaded', () => {
    // 1. Inject shared nav, brand, and templates from the single source of truth
    injectShell();

    // 2. Initialize UI global behaviors
    initUI();

    // 3. Initialize Game of Life engine
    new GameOfLife('golCanvas', {
        gen: 'genDigits',
        alive: 'aliveDigits',
        total: 'totalDigits',
        occ: 'occDigits'
    });

    // 4. Initialize Router
    new Router(routes);
});
