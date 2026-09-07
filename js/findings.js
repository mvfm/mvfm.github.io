import { track } from './analytics.js';
import { getTopicColor, generateMnemonics, getTopicInitials } from './topics.js';
import { fetchFindings, fetchFinding, sourceUrl } from './findings-api.js';
import { buildGraphModel, filterFindings, deriveEventLabel } from './findings-model.js';

const NEUTRAL_TOPIC = 'var(--clr-text-muted)';

// Graph node/edge colours — light-theme, mirror style.css tokens and TYPE_STYLE
// in findings-graph.js (keep the four node hexes in sync with that map).
const GRAPH_PALETTE = {
    label: '#334155',                  // slate, readable on white (cf. --clr-text #0f172a)
    edge:  '#94a3b8',
    finding: '#0d9488',
    topic:   '#64748b',
    event:   '#d97706',
    insight: '#9333ea',
};

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtDate = (d) => {
    if (!d) return '';
    const [y, m] = d.split('-');
    if (!m) return y;
    return new Date(+y, +m - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
};

const state = {
    findings: [], insights: [], model: { nodes: [], edges: [] },
    allTopics: [],                 // shared vocabulary returned by /findings
    topicsInUse: [],               // union of finding topics, always available
    selectedTopics: new Set(),
    query: '',
    graph: null,                   // FindingsGraph instance
    view: 'list', selectedSlug: null,
};

let _filterTimer = null;
let _routeController = null;
let _detailController = null;
let _returnView = 'list';
let _returnScroll = 0;

export function findingsRouteOnUnload() {
    _routeController?.abort();
    _routeController = null;
    _detailController?.abort();
    _detailController = null;
    clearTimeout(_filterTimer);
    state.graph?.destroy();
    state.graph = null;
}

export async function findingsRouteOnLoad() {
    findingsRouteOnUnload();
    const rows = document.getElementById('findings-rows');
    if (!rows) return;
    const ctrl = _routeController = new AbortController();
    const { signal } = ctrl;

    // Filter state is module-level but the template is re-injected fresh on every
    // /findings load — reset so a stale query/topic set can't silently filter the list.
    state.query = '';
    state.view = 'list'; state.selectedSlug = null;
    _returnView = 'list';
    document.querySelector('.findings-split')?.classList.remove('show-map', 'has-detail');
    document.querySelectorAll('[data-findings-view]').forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.findingsView === 'list'));
        btn.addEventListener('click', () => {
            closeDetail();
            setView(btn.dataset.findingsView);
        }, { signal });
    });
    state.selectedTopics.clear();
    state.findings = [];
    state.insights = [];
    state.allTopics = [];
    state.topicsInUse = [];
    state.model = { nodes: [], edges: [] };
    rows.innerHTML = '<li class="loading-text">Loading findings…</li>';
    document.getElementById('contentPanel')?.classList.remove('findings-empty');
    const panel = document.getElementById('findings-detail');
    if (panel) panel.hidden = true;
    renderTopicPills();
    wireDetailDismiss(signal);
    window.addEventListener('hashchange', () => syncDetailHash(signal), { signal });

    try {
        const data = await fetchFindings(signal);
        if (signal.aborted) return;
        state.findings = data.findings;
        state.allTopics = data.topics;
        generateMnemonics(state.allTopics);
    } catch (err) {
        if (signal.aborted) return;
        console.error('[findings] failed to load:', err);
        rows.innerHTML = '<li class="loading-text">Failed to load findings. <button type="button" class="findings-retry">Retry</button></li>';
        rows.querySelector('.findings-retry').addEventListener('click', findingsRouteOnLoad, { signal });
        document.getElementById('contentPanel')?.classList.add('findings-empty');
        await syncDetailHash(signal);
        return;
    }

    if (!state.findings.length) {
        rows.innerHTML = '<li class="loading-text">Nothing here yet.</li>';
        document.getElementById('contentPanel')?.classList.add('findings-empty');
        await syncDetailHash(signal);
        return;
    }

    // Preserve the API's newest-first ordering, including its ID tie-breaker.
    state.model = buildGraphModel(state.findings, state.insights);
    const mapCount = document.getElementById('findings-map-count');
    if (mapCount) mapCount.textContent = `${state.findings.length} findings · ${state.model.edges.length} connections`;
    state.topicsInUse = [...new Set(state.findings.flatMap(f => f.topics || []))].sort();

    wireFilterUI(signal);
    renderTopicPills();
    applyFilter();          // initial full render

    const canvas = document.getElementById('findings-canvas');
    if (canvas) {
        const { FindingsGraph } = await import('./findings-graph.js');
        if (signal.aborted) return;
        state.graph = new FindingsGraph(canvas, state.model, {
            palette: GRAPH_PALETTE,
            topicColor: (label) => state.allTopics.length ? getTopicColor(label, state.allTopics) : null,
            onSelectFinding: (ref) => {
                track('findings_graph_node_click', { node_type: 'finding', id: ref });
                selectFinding(ref, { fromGraph: true });
            },
            onSelectTopic: (ref) => {
                track('findings_graph_node_click', { node_type: 'topic', id: ref });
                state.selectedTopics.has(ref) ? state.selectedTopics.delete(ref) : state.selectedTopics.add(ref);
                renderTopicPills();
                applyFilter();
            },
            onNavigate: (type, ref) => {
                track('findings_graph_node_click', { node_type: type, id: ref });
                track('findings_graph_nav', { node_type: type, slug: ref });
                location.href = type === 'event' ? `/ai#event-${encodeURIComponent(ref)}` : `/insights/${encodeURIComponent(ref)}.html`;
            },
        });

        // zoom buttons
        document.getElementById('findings-graph-controls')?.addEventListener('click', (e) => {
            const z = e.target.dataset.zoom;
            if (z === 'in') state.graph.zoomBy(1.2);
            else if (z === 'out') state.graph.zoomBy(1 / 1.2);
            else if (z === 'reset') state.graph.resetView();
        }, { signal });

        renderLegend();
    }

    // Insights are optional enrichment. Their failure cannot block Findings.
    if (!signal.aborted) void loadInsightTitles(signal);
    await syncDetailHash(signal);
}

function setView(view) {
    if (state.view === view) return;
    state.view = view;
    document.querySelector('.findings-split')?.classList.toggle('show-map', view === 'map');
    document.querySelectorAll('[data-findings-view]').forEach(btn =>
        btn.setAttribute('aria-pressed', String(btn.dataset.findingsView === view)));
    track('findings_map_toggle', { to: view });
    // ResizeObserver updates the canvas after its previously hidden box appears.
    if (view === 'map') state.graph?.requestDraw();
}

function openDetailPanel(panel) {
    if (!document.querySelector('.findings-split')?.classList.contains('has-detail')) {
        _returnScroll = window.scrollY;
        _returnView = state.view;
    }
    setView('list');
    document.querySelector('.findings-split')?.classList.add('has-detail');
    panel.hidden = false;
    panel.scrollTop = 0;
    const heading = panel.querySelector('h3, [role="status"]');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) panel.scrollIntoView({ block: 'start' });
}

async function loadInsightTitles(signal) {
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try {
        const res = await fetch('/insights/manifest.json', { signal: ctrl.signal });
        if (!res.ok) return;
        const insights = await res.json();
        if (signal.aborted || !Array.isArray(insights)) return;
        state.insights = insights;
        const titles = new Map(insights.map(a => [a.slug, a.title]));
        for (const node of state.model.nodes) {
            if (node.type === 'insight') node.label = titles.get(node.ref) || node.label;
        }
        state.graph?.setLabels(new Map(state.model.nodes.map(n => [n.id, n.label])));
        document.querySelectorAll('#findings-detail [data-insight-slug]').forEach(link => {
            const title = titles.get(link.dataset.insightSlug);
            if (title) link.textContent = `✦ ${title}`;
        });
    } catch { /* Optional titles retain their readable slug fallback. */ }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
    }
}

async function syncDetailHash(signal) {
    if (signal.aborted) return;
    _detailController?.abort();
    let slug;
    try { slug = decodeURIComponent(location.hash.slice(1)); }
    catch { showDetailMessage('Finding not found.'); return; }
    if (!slug) { closeDetail(); return; }
    if (state.findings.some(f => f.slug === slug)) {
        selectFinding(slug);
        return;
    }
    const ctrl = _detailController = new AbortController();
    const abort = () => ctrl.abort();
    signal.addEventListener('abort', abort, { once: true });
    showDetailMessage('Loading finding…');
    try {
        const finding = await fetchFinding(slug, ctrl.signal);
        if (!signal.aborted && !ctrl.signal.aborted) selectFinding(slug, { finding });
    } catch (err) {
        if (!signal.aborted && !ctrl.signal.aborted) {
            showDetailMessage(err.status === 404 ? 'Finding not found.' : 'Failed to load finding. Please try again.');
        }
    } finally { signal.removeEventListener('abort', abort); }
}

function showDetailMessage(message) {
    const panel = document.getElementById('findings-detail');
    if (!panel) return;
    panel.innerHTML = `<button class="findings-detail-close" type="button">← Back to Findings</button><p role="status">${esc(message)}</p>`;
    openDetailPanel(panel);
    panel.querySelector('button').addEventListener('click', closeDetail);
}

function currentColorList() {
    return state.allTopics.length ? state.allTopics : state.topicsInUse;
}

export function renderTopicPills() {
    const box = document.getElementById('findings-topic-filters');
    if (!box) return;
    box.innerHTML = '';
    for (const topic of state.topicsInUse) {
        const on = state.selectedTopics.has(topic);
        const pill = document.createElement('div');
        pill.className = `topic-pill ${on ? 'selected' : ''}`;
        pill.textContent = topic;
        const enabledColor = state.allTopics.length ? getTopicColor(topic, state.allTopics, on) : NEUTRAL_TOPIC;
        pill.style.backgroundColor = on ? enabledColor : (state.allTopics.length ? getTopicColor(topic, state.allTopics, false) : 'transparent');
        pill.style.color = on ? '#fff' : 'var(--clr-text-muted)';
        pill.addEventListener('click', () => {
            on ? state.selectedTopics.delete(topic) : state.selectedTopics.add(topic);
            track('findings_filter', {
                query: state.query,
                active_topics: [...state.selectedTopics],
                result_count: filterFindings(state.findings, { query: state.query, topics: [...state.selectedTopics] }).length,
            });
            renderTopicPills();
            applyFilter();
        });
        box.appendChild(pill);
    }
}

export function applyFilter() {
    const rows = document.getElementById('findings-rows');
    if (!rows) return;
    const topics = [...state.selectedTopics];
    const matched = filterFindings(state.findings, { query: state.query, topics });
    const matchedSlugs = new Set(matched.map(f => f.slug));

    rows.innerHTML = matched.length
        ? matched.map(f => rowHtml(f)).join('')
        : '<li class="loading-text">No findings match.</li>';

    rows.querySelectorAll('.finding-row').forEach(li => {
        li.querySelector('button').addEventListener('click', () => selectFinding(li.dataset.slug));
        li.classList.toggle('active', li.dataset.slug === state.selectedSlug);
    });

    state.graph?.setFilter({ matchedFindingSlugs: matchedSlugs });
}

function renderLegend() {
    const el = document.getElementById('findings-graph-legend');
    if (!el) return;

    const swatch = (color, label) =>
        `<span><i style="background:${color}"></i>${esc(label)}</span>`;

    // Fixed node types.
    const parts = [
        swatch(GRAPH_PALETTE.finding, 'Finding'),
        swatch(GRAPH_PALETTE.event, 'Event'),
        swatch(GRAPH_PALETTE.insight, 'Insight'),
    ];

    for (const topic of state.topicsInUse) {
        parts.push(swatch(state.allTopics.length ? getTopicColor(topic, state.allTopics, true) : GRAPH_PALETTE.topic, topic));
    }

    el.innerHTML = parts.join('');
}

function rowHtml(f) {
    const dots = (f.topics || []).map(t => {
        const c = state.allTopics.length ? getTopicColor(t, state.allTopics, true) : NEUTRAL_TOPIC;
        return `<span class="finding-dot" style="background:${c}" title="${esc(t)}"></span>`;
    }).join('');
    const refs = [];
    if ((f.referenced_insights || []).length) refs.push(`${f.referenced_insights.length} Insight${f.referenced_insights.length === 1 ? '' : 's'}`);
    if ((f.referenced_events || []).length) refs.push(`${f.referenced_events.length} timeline ${f.referenced_events.length === 1 ? 'entry' : 'entries'}`);
    return `<li class="finding-row" data-slug="${esc(f.slug)}">
        <button type="button" class="finding-row-open" aria-label="Read ${esc(f.title)}">
        <span class="finding-row-meta">${esc(f.source)} · ${esc(fmtDate(f.date_added))}</span>
        <span class="finding-row-title">${esc(f.title)}</span>
        ${f.note ? `<span class="finding-row-excerpt">${esc(f.note.length > 240 ? f.note.slice(0, 240).trimEnd() + '…' : f.note)}</span>` : ''}
        <span class="finding-row-tags">${dots}${refs.length ? `<span class="finding-refs">${refs.join(' · ')}</span>` : ''}</span>
        </button>
    </li>`;
}

function wireFilterUI(signal) {
    const toggle = document.getElementById('findings-search-toggle');
    const bar = document.getElementById('findings-filter');
    const input = document.getElementById('findings-search-input');
    const clear = document.getElementById('findings-filter-clear');
    if (!toggle || !bar || !input || !clear) return;

    toggle.addEventListener('click', () => {
        bar.classList.toggle('show');
        if (bar.classList.contains('show')) input.focus();
    }, { signal });
    input.addEventListener('input', () => {
        state.query = input.value;
        clearTimeout(_filterTimer);
        _filterTimer = setTimeout(() => {
            track('findings_filter', {
                query: state.query,
                active_topics: [...state.selectedTopics],
                result_count: filterFindings(state.findings, { query: state.query, topics: [...state.selectedTopics] }).length,
            });
        }, 400);
        applyFilter();
    }, { signal });
    clear.addEventListener('click', () => {
        state.query = ''; input.value = ''; state.selectedTopics.clear();
        renderTopicPills(); applyFilter();
    }, { signal });
}

function selectFinding(slug, { fromGraph = false, finding = null } = {}) {
    _detailController?.abort();
    const f = finding || state.findings.find(x => x.slug === slug);
    const panel = document.getElementById('findings-detail');
    if (!f || !panel) return;
    state.selectedSlug = slug;

    document.querySelectorAll('.finding-row.active').forEach(el => el.classList.remove('active'));
    const row = document.querySelector(`.finding-row[data-slug="${CSS.escape(slug)}"]`);
    if (row) row.classList.add('active');

    const colors = currentColorList();
    // Acronym pills, coloured to match the AI timeline's entry labels.
    const topicPills = (f.topics || []).map(t => {
        const bg = state.allTopics.length ? getTopicColor(t, colors, true) : NEUTRAL_TOPIC;
        return `<span class="finding-topic-pill" style="background-color:${bg}" title="${esc(t)}">${esc(getTopicInitials(t))}</span>`;
    }).join('');

    const insightChips = (f.referenced_insights || []).map(s => {
        const title = (state.insights.find(a => a.slug === s) || {}).title || deriveEventLabel(s);
        return `<a class="finding-chip" data-insight-slug="${esc(s)}" href="/insights/${esc(encodeURIComponent(s))}.html">✦ ${esc(title)}</a>`;
    }).join('');

    const eventChips = (f.referenced_events || []).map(e =>
        `<a class="finding-chip" href="/ai#event-${esc(encodeURIComponent(e.slug))}">⧉ ${esc(e.title)}</a>`
    ).join('');
    const url = sourceUrl(f.url);

    panel.innerHTML = `
        <button class="findings-detail-close" type="button">← Back to Findings</button>
        <h3>${esc(f.title)}</h3>
        <p class="findings-detail-meta">${esc(f.source)} · ${esc(fmtDate(f.date_added))}</p>
        ${f.note ? `<p class="findings-detail-note">${esc(f.note)}</p>` : ''}
        ${topicPills ? `<div class="findings-detail-topics">${topicPills}</div>` : ''}
        ${eventChips ? `<section class="findings-references"><h4>Timeline entries</h4><div class="findings-detail-chiprow">${eventChips}</div>
            <a class="findings-view-timeline" href="/ai?slugs=${encodeURIComponent(f.referenced_events.map(e => e.slug).join(','))}">View these entries in the timeline →</a></section>` : ''}
        ${insightChips ? `<section class="findings-references"><h4>Insights</h4><div class="findings-detail-chiprow">${insightChips}</div></section>` : ''}
        ${url ? `<a class="btn-primary findings-visit" href="${esc(url)}" target="_blank" rel="noopener">Visit Source ↗</a>` : ''}`;
    openDetailPanel(panel);

    panel.querySelector('.findings-detail-close').addEventListener('click', closeDetail);
    panel.querySelector('.findings-visit')?.addEventListener('click', () => {
        track('finding_source_visit', { slug: f.slug, url: f.url });
    });

    if (location.hash !== `#${encodeURIComponent(slug)}`) history.replaceState(history.state, '', `#${encodeURIComponent(slug)}`);
    track('finding_view', { slug: f.slug });

    // Reading a list item does not alter the map's camera.
}

function closeDetail() {
    _detailController?.abort();
    const panel = document.getElementById('findings-detail');
    if (!panel) return;
    panel.hidden = true;
    const wasOpen = document.querySelector('.findings-split')?.classList.contains('has-detail');
    document.querySelector('.findings-split')?.classList.remove('has-detail');
    const selected = state.selectedSlug;
    state.selectedSlug = null;
    if (wasOpen) {
        setView(_returnView);
        if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo({ top: _returnScroll, behavior: 'instant' });
        const target = _returnView === 'map' ? document.querySelector('[data-findings-view="map"]') :
            document.querySelector(`.finding-row[data-slug="${CSS.escape(selected || '')}"] button`);
        target?.focus({ preventScroll: true });
    }
    document.querySelectorAll('.finding-row.active').forEach(el => el.classList.remove('active'));
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

// A dedicated reading pane stays open while the reader uses the list/filters.
function wireDetailDismiss(signal) {
    const onKey = (e) => { if (e.key === 'Escape') closeDetail(); };
    document.addEventListener('keydown', onKey, { signal });
}

export { state as _state };
export { selectFinding, closeDetail };
