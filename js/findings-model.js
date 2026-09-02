// Pure helpers for the Findings section. No DOM, no canvas.

// Human labels for timeline-event slugs whose un-slugified form is wrong
// (acronyms, internal capitalisation). Starts empty; add one line per
// acronym-y event as it is first referenced by a finding, e.g.:
//   'gpt-4': 'GPT-4', 'openai': 'OpenAI', 'rag': 'RAG', 'nlp': 'NLP'
export const TOPIC_LABEL_OVERRIDES = {
    'ai-gets-its-name': 'AI Gets Its Name',
};

export function deriveEventLabel(slug, overrides = TOPIC_LABEL_OVERRIDES) {
    if (!slug || typeof slug !== 'string') return '';
    if (overrides[slug]) return overrides[slug];
    return slug
        .replace(/^_/, '')                // TimelineJS prefixes digit-leading slugs with "_"
        .split('-')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export function buildGraphModel(findings, insights) {
    const insightTitle = new Map((insights || []).map(a => [a.slug, a.title]));
    const nodes = new Map();   // id -> node
    const edges = [];

    const addNode = (id, type, label, ref) => {
        if (!nodes.has(id)) nodes.set(id, { id, type, label, ref });
    };

    for (const f of (findings || [])) {
        const fid = `finding:${f.slug}`;
        addNode(fid, 'finding', f.title, f.slug);

        for (const t of (f.topics || [])) {
            const id = `topic:${t}`;
            addNode(id, 'topic', t, t);
            edges.push({ source: fid, target: id });
        }
        for (const ev of (f.referenced_events || [])) {
            const id = `event:${ev}`;
            addNode(id, 'event', deriveEventLabel(ev), ev);
            edges.push({ source: fid, target: id });
        }
        for (const ins of (f.referenced_insights || [])) {
            const id = `insight:${ins}`;
            addNode(id, 'insight', insightTitle.get(ins) || deriveEventLabel(ins), ins);
            edges.push({ source: fid, target: id });
        }
    }

    return { nodes: [...nodes.values()], edges };
}

export function filterFindings(findings, { query = '', topics = [] } = {}) {
    const q = query.trim().toLowerCase();
    return (findings || []).filter(f => {
        const hay = `${f.title || ''} ${f.source || ''} ${f.note || ''}`.toLowerCase();
        if (q && !hay.includes(q)) return false;
        return topics.every(t => (f.topics || []).includes(t));
    });
}
