// Pure helpers for the Findings section. No DOM, no canvas.

// Human labels for timeline-event slugs whose un-slugified form is wrong
// (acronyms, internal capitalisation). Starts empty; add one line per
// acronym-y event as it is first referenced by a finding, e.g.:
//   'gpt-4': 'GPT-4', 'openai': 'OpenAI', 'rag': 'RAG', 'nlp': 'NLP'
export const TOPIC_LABEL_OVERRIDES = {};

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

// buildGraphModel + filterFindings added in Task 3 / Task 6.
export const buildGraphModel = () => ({ nodes: [], edges: [] });
export const filterFindings = (f) => f;
