import { track } from './analytics.js';
import { getTopicColor } from './topics.js';
import { API_BASE_URL } from './config.js';
import { buildGraphModel, filterFindings, deriveEventLabel } from './findings-model.js';

const NEUTRAL_TOPIC = 'var(--clr-text-muted)';

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
    allTopics: [],                 // full sorted list once /timeline answers (Task 12)
    topicsInUse: [],               // union of finding topics, always available
    selectedTopics: new Set(),
    query: '',
    graph: null,                   // FindingsGraph instance (Task 11)
};

let _filterTimer = null;

export async function findingsRouteOnLoad() {
    const rows = document.getElementById('findings-rows');
    if (!rows) return;

    try {
        const [fRes, iRes] = await Promise.all([
            fetch('/findings/manifest.json'),
            fetch('/insights/manifest.json').catch(() => null),
        ]);
        if (!fRes.ok) throw new Error(`HTTP ${fRes.status}`);
        state.findings = await fRes.json();
        state.insights = iRes && iRes.ok ? await iRes.json() : [];
    } catch (err) {
        console.error('[findings] failed to load manifest:', err);
        rows.innerHTML = '<li class="loading-text" style="color:#ff6b6b">Failed to load findings.</li>';
        return;
    }

    if (!state.findings.length) {
        rows.innerHTML = '<li class="loading-text">Nothing here yet.</li>';
        return;
    }

    state.findings.sort((a, b) => (b.date_added || '').localeCompare(a.date_added || ''));
    state.model = buildGraphModel(state.findings, state.insights);
    state.topicsInUse = [...new Set(state.findings.flatMap(f => f.topics || []))].sort();

    renderTopicPills();
    applyFilter();          // initial full render
    wireFilterUI();
    wireDetailDismiss();

    // Task 12: non-blocking /timeline fetch purely for topic colours.
    // Runs AFTER the list + graph render; never awaited, never gates the UI.
    // On failure everything stays neutral and the tab remains fully usable.
    {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 15000);
        fetch(`${API_BASE_URL}/timeline`, { signal: ctrl.signal })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(data => {
                if (!Array.isArray(data.topics) || !data.topics.length) return;
                state.allTopics = data.topics;          // verbatim; getTopicColor sorts internally
                renderTopicPills();                     // recolour topic pills
                applyFilter();                          // re-render rows → recoloured topic dots
                state.graph?.requestDraw();             // late-bound topicColor repaints topic nodes
            })
            .catch(err => {
                console.warn('[findings] topic colours unavailable:', err.message);
            })
            .finally(() => clearTimeout(timeoutId));
    }

    state.graph?.destroy?.();
    state.graph = null;

    const canvas = document.getElementById('findings-canvas');
    if (canvas) {
        const { FindingsGraph } = await import('./findings-graph.js');
        state.graph = new FindingsGraph(canvas, state.model, {
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
                location.href = type === 'event' ? `/ai#event-${ref}` : `/insights/${ref}.html`;
            },
        });

        // zoom buttons
        document.getElementById('findings-graph-controls')?.addEventListener('click', (e) => {
            const z = e.target.dataset.zoom;
            if (z === 'in') state.graph.zoomBy(1.2);
            else if (z === 'out') state.graph.zoomBy(1 / 1.2);
            else if (z === 'reset') state.graph.resetView();
        });

        renderLegend();
    }

    // Mobile: #findings-map-toggle swaps the list ⇄ graph on narrow viewports.
    const mapToggle = document.getElementById('findings-map-toggle');
    const split = document.querySelector('.findings-split');
    mapToggle?.addEventListener('click', () => {
        const showingMap = split.classList.toggle('show-map');
        mapToggle.textContent = showingMap ? 'List' : 'Map';
        track('findings_map_toggle', { to: showingMap ? 'map' : 'list' });
        if (showingMap) requestAnimationFrame(() => state.graph?.requestDraw());
    });

    const hashSlug = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (hashSlug && state.findings.some(f => f.slug === hashSlug)) {
        selectFinding(hashSlug);
    }
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
        li.addEventListener('click', () => selectFinding(li.dataset.slug));
    });

    state.graph?.setFilter({ matchedFindingSlugs: matchedSlugs });
}

function renderLegend() {
    const el = document.getElementById('findings-graph-legend');
    if (!el) return;
    const items = [
        ['#8b5cf6', 'Finding'], ['#64748b', 'Topic'], ['#f59e0b', 'Event'], ['#ec4899', 'Insight'],
    ];
    el.innerHTML = items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
}

function rowHtml(f) {
    const dots = (f.topics || []).map(t => {
        const c = state.allTopics.length ? getTopicColor(t, state.allTopics, true) : NEUTRAL_TOPIC;
        return `<span class="finding-dot" style="background:${c}" title="${esc(t)}"></span>`;
    }).join('');
    const refs = [];
    if ((f.referenced_insights || []).length) refs.push(`✦${f.referenced_insights.length}`);
    if ((f.referenced_events || []).length) refs.push(`⧉${f.referenced_events.length}`);
    return `<li class="finding-row" data-slug="${esc(f.slug)}">
        <div class="finding-row-main">
            <span class="finding-row-title">${esc(f.title)}</span>
            <span class="finding-row-meta">${esc(f.source)} · ${esc(fmtDate(f.date_added))}</span>
        </div>
        <div class="finding-row-tags">${dots}${refs.length ? `<span class="finding-refs">${refs.join(' ')}</span>` : ''}</div>
    </li>`;
}

function wireFilterUI() {
    const toggle = document.getElementById('findings-search-toggle');
    const bar = document.getElementById('findings-filter');
    const input = document.getElementById('findings-search-input');
    const clear = document.getElementById('findings-filter-clear');
    if (!toggle || !bar || !input || !clear) return;

    toggle.addEventListener('click', () => {
        bar.classList.toggle('show');
        if (bar.classList.contains('show')) input.focus();
    });
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
    });
    clear.addEventListener('click', () => {
        state.query = ''; input.value = ''; state.selectedTopics.clear();
        renderTopicPills(); applyFilter();
    });
}

function selectFinding(slug, { fromGraph = false } = {}) {
    const f = state.findings.find(x => x.slug === slug);
    const panel = document.getElementById('findings-detail');
    if (!f || !panel) return;

    document.querySelectorAll('.finding-row.active').forEach(el => el.classList.remove('active'));
    const row = document.querySelector(`.finding-row[data-slug="${CSS.escape(slug)}"]`);
    if (row) { row.classList.add('active'); row.scrollIntoView({ block: 'nearest' }); }

    const colors = currentColorList();
    const topicPills = (f.topics || []).map(t =>
        `<span class="topic-pill selected" style="background:${state.allTopics.length ? getTopicColor(t, colors, true) : NEUTRAL_TOPIC};color:#fff">${esc(t)}</span>`
    ).join('');

    const insightChips = (f.referenced_insights || []).map(s => {
        const title = (state.insights.find(a => a.slug === s) || {}).title || deriveEventLabel(s);
        return `<a class="finding-chip" href="/insights/${esc(s)}.html">✦ ${esc(title)}</a>`;
    }).join('');

    const eventChips = (f.referenced_events || []).map(s =>
        `<a class="finding-chip" href="/ai#event-${esc(s)}">⧉ ${esc(deriveEventLabel(s))}</a>`
    ).join('');

    panel.innerHTML = `
        <button class="findings-detail-close" aria-label="Close">&#x2715;</button>
        <h3>${esc(f.title)}</h3>
        <p class="findings-detail-meta">${esc(f.source)} · ${esc(fmtDate(f.date_added))}</p>
        ${f.note ? `<p class="findings-detail-note">${esc(f.note)}</p>` : ''}
        ${topicPills ? `<div class="findings-detail-topics">${topicPills}</div>` : ''}
        ${insightChips ? `<div class="findings-detail-chiprow">${insightChips}</div>` : ''}
        ${eventChips ? `<div class="findings-detail-chiprow">${eventChips}</div>` : ''}
        <a class="btn-primary findings-visit" href="${esc(f.url)}" target="_blank" rel="noopener">Visit source ↗</a>`;
    panel.hidden = false;
    panel.classList.add('show');

    panel.querySelector('.findings-detail-close').addEventListener('click', closeDetail);
    panel.querySelector('.findings-visit').addEventListener('click', () => {
        track('finding_source_visit', { slug: f.slug, url: f.url });
    });

    if (location.hash !== `#${slug}`) history.replaceState(null, '', `#${slug}`);
    track('finding_view', { slug: f.slug });

    if (!fromGraph) state.graph?.focus?.(`finding:${slug}`);
}

function closeDetail() {
    const panel = document.getElementById('findings-detail');
    if (!panel) return;
    panel.classList.remove('show');
    panel.hidden = true;
    document.querySelectorAll('.finding-row.active').forEach(el => el.classList.remove('active'));
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

// Esc + click-outside dismiss — attach once per route load.
function wireDetailDismiss() {
    const onKey = (e) => { if (e.key === 'Escape') closeDetail(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('findings-detail');
        if (!panel || panel.hidden) return;
        if (panel.contains(e.target)) return;
        if (e.target.closest('.finding-row') || e.target.closest('#findings-canvas')) return;
        closeDetail();
    });
}

export { state as _state };
export { selectFinding, closeDetail };
