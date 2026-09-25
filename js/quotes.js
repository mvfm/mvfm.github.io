import { track } from './analytics.js';
import { fetchQuotes, fetchQuote, sourceUrl } from './quotes-api.js';
import { formatQuoteDate, kindLabel, filterQuotes, speakersOf, quoteNotes } from './quotes-model.js';
import { deriveEventLabel } from './findings-model.js';
import { getTopicColor, generateMnemonics, getTopicInitials } from './topics.js';

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const state = {
    quotes: [], topics: [], topicsInUse: [], kinds: [],
    filters: { query: '', topics: [], speaker: '', kind: '' },
    selectedSlug: null,
};

let _filterTimer = null;
let _routeController = null;
let _detailController = null;
let _returnScroll = 0;

export function quotesRouteOnUnload() {
    _routeController?.abort();
    _routeController = null;
    _detailController?.abort();
    _detailController = null;
    clearTimeout(_filterTimer);
}

const hasActiveFilter = () => !!(state.filters.query || state.filters.topics.length || state.filters.speaker || state.filters.kind);

export async function quotesRouteOnLoad() {
    quotesRouteOnUnload();
    const rows = document.getElementById('quotes-rows');
    if (!rows) return;
    const ctrl = _routeController = new AbortController();
    const { signal } = ctrl;

    // Module state outlives the template, which is re-injected fresh on each load.
    const params = new URLSearchParams(location.search);
    state.quotes = []; state.topics = []; state.topicsInUse = []; state.kinds = [];
    state.filters = {
        query: params.get('q') || '',
        topics: (params.get('topics') || '').split(',').map(t => t.trim()).filter(Boolean),
        speaker: params.get('speaker') || '',
        kind: params.get('kind') || '',
    };
    state.selectedSlug = null;
    document.querySelector('.quotes-split')?.classList.remove('has-detail');
    const panel = document.getElementById('quotes-detail');
    if (panel) panel.hidden = true;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '')) closeDetail(); }, { signal });
    window.addEventListener('hashchange', () => syncDetailHash(signal), { signal });

    try {
        const data = await fetchQuotes(signal);
        if (signal.aborted) return;
        state.quotes = data.quotes; state.topics = data.topics; state.kinds = data.kinds;
        generateMnemonics(state.topics);
    } catch (err) {
        if (signal.aborted) return;
        console.error('[quotes] failed to load:', err);
        rows.innerHTML = '<li class="loading-text">Failed to load quotes. <button type="button" class="quotes-retry">Retry</button></li>';
        rows.querySelector('.quotes-retry').addEventListener('click', quotesRouteOnLoad, { signal });
        await syncDetailHash(signal);
        return;
    }

    if (!state.quotes.length) {
        rows.innerHTML = '<li class="loading-text">Nothing here yet.</li>';
        await syncDetailHash(signal);
        return;
    }

    state.topicsInUse = [...new Set(state.quotes.flatMap(q => q.topics || []))].sort();
    wireFilters(signal);
    renderTopicPills();
    applyFilter();
    await syncDetailHash(signal);
}

function fillSelect(id, values, current, label = (v) => v) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">All</option>' +
        values.map(v => `<option value="${esc(v)}">${esc(label(v))}</option>`).join('');
    // a URL value the vocabulary does not know is dropped rather than silently filtering to nothing
    select.value = values.includes(current) ? current : '';
}

function trackFilter() {
    const f = state.filters;
    track('quotes_filter', {
        query: f.query, speaker: f.speaker, topic: f.topics.join(','), kind: f.kind,
        result_count: filterQuotes(state.quotes, f).length,
    });
}

function colorList() {
    return state.topics.length ? state.topics : state.topicsInUse;
}

export function renderTopicPills() {
    const box = document.getElementById('quotes-topic-filters');
    if (!box) return;
    box.innerHTML = '';
    for (const topic of state.topicsInUse) {
        const on = state.filters.topics.includes(topic);
        const pill = document.createElement('div');
        pill.className = `topic-pill ${on ? 'selected' : ''}`;
        pill.textContent = topic;
        pill.style.backgroundColor = getTopicColor(topic, colorList(), on);
        pill.style.color = on ? '#fff' : 'var(--clr-text-muted)';
        pill.addEventListener('click', () => {
            state.filters.topics = on ? state.filters.topics.filter(t => t !== topic) : [...state.filters.topics, topic];
            trackFilter();
            renderTopicPills();
            applyFilter();
        });
        box.appendChild(pill);
    }
}

function wireFilters(signal) {
    const bar = document.getElementById('quotes-filter');
    const input = document.getElementById('quotes-search-input');
    const toggle = document.getElementById('quotes-search-toggle');

    // topics unknown to the data are dropped, like unknown speaker/kind
    state.filters.topics = state.filters.topics.filter(t => state.topicsInUse.includes(t));
    fillSelect('quotes-speaker', speakersOf(state.quotes), state.filters.speaker);
    fillSelect('quotes-kind', state.kinds, state.filters.kind, kindLabel);
    state.filters.speaker = document.getElementById('quotes-speaker').value;
    state.filters.kind = document.getElementById('quotes-kind').value;
    if (input) input.value = state.filters.query;
    if (hasActiveFilter()) bar?.classList.add('show');

    toggle?.addEventListener('click', () => {
        bar?.classList.toggle('show');
        if (bar?.classList.contains('show')) input?.focus();
    }, { signal });
    input?.addEventListener('input', () => {
        state.filters.query = input.value;
        clearTimeout(_filterTimer);
        _filterTimer = setTimeout(trackFilter, 400);
        applyFilter();
    }, { signal });
    for (const key of ['speaker', 'kind']) {
        document.getElementById(`quotes-${key}`)?.addEventListener('change', (e) => {
            state.filters[key] = e.target.value;
            applyFilter();
            trackFilter();
        }, { signal });
    }
    document.getElementById('quotes-filter-clear')?.addEventListener('click', () => {
        state.filters = { query: '', topics: [], speaker: '', kind: '' };
        if (input) input.value = '';
        for (const key of ['speaker', 'kind']) document.getElementById(`quotes-${key}`).value = '';
        clearTimeout(_filterTimer);
        renderTopicPills();
        applyFilter();
    }, { signal });
}

function writeFilterUrl() {
    const params = new URLSearchParams(location.search);
    const f = state.filters;
    const set = (k, v) => { if (v) params.set(k, v); else params.delete(k); };
    set('q', f.query.trim());
    set('topics', f.topics.join(','));
    set('speaker', f.speaker);
    set('kind', f.kind);
    params.delete('topic'); // legacy single-topic param
    const qs = params.toString();
    history.replaceState(history.state, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
}

export function applyFilter() {
    const rows = document.getElementById('quotes-rows');
    if (!rows) return;
    const matched = filterQuotes(state.quotes, state.filters);
    rows.innerHTML = matched.length
        ? matched.map(rowHtml).join('')
        : '<li class="loading-text">No quotes match.</li>';
    rows.querySelectorAll('.quote-row').forEach(li => {
        li.querySelector('button').addEventListener('click', () => selectQuote(li.dataset.slug));
        li.classList.toggle('active', li.dataset.slug === state.selectedSlug);
    });
    const count = document.getElementById('quotes-count');
    if (count) count.textContent = `${matched.length} of ${state.quotes.length} quotes`;
    writeFilterUrl();
}

function rowHtml(q) {
    const notes = quoteNotes(q);
    const attrib = esc(q.speaker) + (q.speaker_role ? `, ${esc(q.speaker_role)}` : '');
    const dots = (q.topics || []).map(t =>
        `<span class="finding-dot" style="background:${getTopicColor(t, colorList(), true)}" title="${esc(t)}"></span>`).join('');
    return `<li class="quote-row" data-slug="${esc(q.slug)}">
        <button type="button" class="quote-row-open" aria-label="Read quote by ${esc(q.speaker)}">
        <span class="quote-row-kind">${esc(kindLabel(q.kind))}</span>
        <span class="quote-row-text">“${esc(q.text)}”</span>
        <span class="quote-row-attrib">${attrib}</span>
        <span class="quote-row-meta finding-row-meta">${esc(formatQuoteDate(q.quote_date, q.date_precision))}${notes.length ? ` · ${esc(notes.join(' · '))}` : ''}</span>
        ${dots ? `<span class="finding-row-tags">${dots}</span>` : ''}
        </button>
    </li>`;
}

function openDetailPanel(panel) {
    const split = document.querySelector('.quotes-split');
    if (!split?.classList.contains('has-detail')) _returnScroll = window.scrollY;
    split?.classList.add('has-detail');
    panel.hidden = false;
    panel.scrollTop = 0;
    const heading = panel.querySelector('blockquote, [role="status"]');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) panel.scrollIntoView({ block: 'start' });
}

// The list scrolls inside its own box next to the reading pane, so bring the open quote
// into view. Only when it is outside the visible part: clicking a visible row must not
// move the list. (Hidden on mobile, where the list is not displayed while reading.)
function revealRow(slug) {
    const list = document.querySelector('.quotes-list');
    const row = document.querySelector(`.quote-row[data-slug="${CSS.escape(slug)}"]`);
    if (!list || !row || list.scrollHeight <= list.clientHeight) return;
    const l = list.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top >= l.top && r.bottom <= l.bottom) return;
    list.scrollTop += (r.top - l.top) - (list.clientHeight - r.height) / 2;
}

function showDetailMessage(message) {
    const panel = document.getElementById('quotes-detail');
    if (!panel) return;
    panel.innerHTML = `<button class="findings-detail-close" type="button">← Back to Quotes</button><p role="status">${esc(message)}</p>`;
    openDetailPanel(panel);
    panel.querySelector('button').addEventListener('click', closeDetail);
}

async function syncDetailHash(signal) {
    if (signal.aborted) return;
    _detailController?.abort();
    let slug;
    try { slug = decodeURIComponent(location.hash.slice(1)); }
    catch { showDetailMessage('Quote not found.'); return; }
    if (!slug) { closeDetail(); return; }
    if (state.quotes.some(q => q.slug === slug)) { selectQuote(slug); return; }
    const ctrl = _detailController = new AbortController();
    const abort = () => ctrl.abort();
    signal.addEventListener('abort', abort, { once: true });
    showDetailMessage('Loading quote…');
    try {
        const quote = await fetchQuote(slug, ctrl.signal);
        if (!signal.aborted && !ctrl.signal.aborted) selectQuote(slug, { quote });
    } catch (err) {
        if (!signal.aborted && !ctrl.signal.aborted) {
            showDetailMessage(err.status === 404 ? 'Quote not found.' : 'Failed to load quote. Please try again.');
        }
    } finally { signal.removeEventListener('abort', abort); }
}

export function selectQuote(slug, { quote = null } = {}) {
    _detailController?.abort();
    const q = quote || state.quotes.find(x => x.slug === slug);
    const panel = document.getElementById('quotes-detail');
    if (!q || !panel) return;
    state.selectedSlug = slug;
    document.querySelectorAll('.quote-row.active').forEach(el => el.classList.remove('active'));
    document.querySelector(`.quote-row[data-slug="${CSS.escape(slug)}"]`)?.classList.add('active');

    const notes = quoteNotes(q);
    const url = sourceUrl(q.source_url);
    const events = q.referenced_events.map(e =>
        `<a class="finding-chip" href="/ai#event-${esc(encodeURIComponent(e.slug))}">⧉ ${esc(e.title || deriveEventLabel(e.slug))}</a>`).join('');
    const insights = q.referenced_insights.map(s =>
        `<a class="finding-chip" href="/insights/${esc(encodeURIComponent(s))}.html">✦ ${esc(deriveEventLabel(s))}</a>`).join('');
    const finding = q.source_finding
        ? `<a class="finding-chip" href="/findings/#${esc(encodeURIComponent(q.source_finding.slug))}">◈ ${esc(q.source_finding.title)}</a>` : '';
    const attrib = esc(q.speaker) + (q.speaker_role ? `, ${esc(q.speaker_role)}` : '');
    const topicPills = (q.topics || []).map(t =>
        `<span class="finding-topic-pill" style="background-color:${getTopicColor(t, colorList(), true)}" title="${esc(t)}">${esc(getTopicInitials(t))}</span>`).join('');

    panel.innerHTML = `
        <button class="findings-detail-close" type="button">← Back to Quotes</button>
        <blockquote class="quotes-detail-text">${esc(q.text)}</blockquote>
        <p class="quotes-detail-attrib">${attrib}</p>
        <p class="quotes-detail-meta">${esc(kindLabel(q.kind))} · ${esc(formatQuoteDate(q.quote_date, q.date_precision))}${notes.length ? ` · ${esc(notes.join(' · '))}` : ''}</p>
        ${topicPills ? `<div class="findings-detail-topics">${topicPills}</div>` : ''}
        <p class="quotes-detail-context">${esc(q.context)}</p>
        <p class="quotes-detail-source">${esc(q.source_title)}${q.locator ? ` — ${esc(q.locator)}` : ''}</p>
        ${events ? `<section class="findings-references"><h4>Timeline entries</h4><div class="findings-detail-chiprow">${events}</div></section>` : ''}
        ${insights ? `<section class="findings-references"><h4>Insights</h4><div class="findings-detail-chiprow">${insights}</div></section>` : ''}
        ${finding ? `<section class="findings-references"><h4>Source finding</h4><div class="findings-detail-chiprow">${finding}</div></section>` : ''}
        ${url ? `<a class="btn-primary findings-visit" href="${esc(url)}" target="_blank" rel="noopener">Visit Source ↗</a>` : ''}`;
    openDetailPanel(panel);
    revealRow(slug);
    panel.querySelector('.findings-detail-close').addEventListener('click', closeDetail);
    panel.querySelector('.findings-visit')?.addEventListener('click', () => {
        track('quote_source_visit', { slug: q.slug, url: q.source_url });
    });

    if (location.hash !== `#${encodeURIComponent(slug)}`) history.replaceState(history.state, '', `${location.pathname}${location.search}#${encodeURIComponent(slug)}`);
    track('quote_view', { slug: q.slug });
}

export function closeDetail() {
    _detailController?.abort();
    const panel = document.getElementById('quotes-detail');
    if (!panel) return;
    const split = document.querySelector('.quotes-split');
    const wasOpen = split?.classList.contains('has-detail');
    panel.hidden = true;
    split?.classList.remove('has-detail');
    const selected = state.selectedSlug;
    state.selectedSlug = null;
    if (wasOpen) {
        const row = document.querySelector(`.quote-row[data-slug="${CSS.escape(selected || '')}"]`);
        if (window.matchMedia('(max-width: 760px)').matches) {
            window.scrollTo({ top: _returnScroll, behavior: 'instant' });
            // opened from a deep link (nothing to restore): show where the quote sits in the list
            const r = row?.getBoundingClientRect();
            if (r && (r.bottom < 0 || r.top > window.innerHeight)) row.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
        row?.querySelector('button')?.focus({ preventScroll: true });
    }
    document.querySelectorAll('.quote-row.active').forEach(el => el.classList.remove('active'));
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

export { state as _state };
