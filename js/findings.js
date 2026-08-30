import { track } from './analytics.js';
import { getTopicColor } from './topics.js';
import { buildGraphModel, filterFindings } from './findings-model.js';

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

    // Task 11 instantiates the graph here.
    // Task 12 kicks off the non-blocking /timeline topic-colour fetch here.
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

    // Task 11: state.graph?.setFilter({ matchedFindingSlugs: matchedSlugs });
}

function rowHtml(f) {
    const dots = (f.topics || []).map(t => {
        const c = state.allTopics.length ? getTopicColor(t, state.allTopics) : NEUTRAL_TOPIC;
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

// Placeholder until Task 7.
function selectFinding(slug) { console.log('[findings] select', slug); }

export { state as _state };
