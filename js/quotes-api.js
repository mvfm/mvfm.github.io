import { readJson } from './findings-api.js';

export { sourceUrl } from './findings-api.js';

const DATE_PRECISIONS = ['exact', 'month', 'year'];
const VERIFICATIONS = ['primary', 'secondary'];
const nonEmpty = (v) => typeof v === 'string' && v.length > 0;
const nullableString = (v) => v === null || typeof v === 'string';

// Keep the wire contract at the fetch boundary; components consume plain data.
export function validateQuote(q) {
    const ok = q && Number.isInteger(q.id) &&
        ['slug', 'text', 'speaker', 'source_title', 'context', 'kind', 'language', 'updated_at'].every(k => nonEmpty(q[k])) &&
        nullableString(q.speaker_role) && nullableString(q.locator) &&
        /^https?:\/\//.test(q.source_url) &&
        /^\d{4}-\d{2}-\d{2}$/.test(q.quote_date) &&
        DATE_PRECISIONS.includes(q.date_precision) &&
        VERIFICATIONS.includes(q.verification) &&
        typeof q.is_translation === 'boolean' &&
        Array.isArray(q.topics) && q.topics.every(t => typeof t === 'string') &&
        Array.isArray(q.referenced_insights) && q.referenced_insights.every(s => typeof s === 'string') &&
        Array.isArray(q.referenced_events) && q.referenced_events.every(e =>
            e && Number.isInteger(e.id) && nonEmpty(e.slug) && typeof e.title === 'string') &&
        (q.source_finding === null || (q.source_finding && Number.isInteger(q.source_finding.id) &&
            ['slug', 'title', 'source'].every(k => typeof q.source_finding[k] === 'string')));
    if (!ok) throw new Error('Invalid quote response');
    return q;
}

export async function fetchQuotes(signal) {
    const data = await readJson('/quotes', signal);
    if (!data || !Array.isArray(data.quotes) || !Array.isArray(data.topics) ||
        !Array.isArray(data.kinds) || data.total !== data.quotes.length) {
        throw new Error('Invalid quotes collection');
    }
    data.quotes.forEach(validateQuote);
    if (new Set(data.quotes.map(q => q.slug)).size !== data.quotes.length) {
        throw new Error('Duplicate quote slug');
    }
    return data;
}

export async function fetchQuote(slug, signal) {
    const data = await readJson(`/quotes/${encodeURIComponent(slug)}`, signal);
    const quote = validateQuote(data?.quote);
    if (quote.slug !== slug) throw new Error('Quote slug does not match request');
    return quote;
}
