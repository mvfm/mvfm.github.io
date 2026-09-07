import { API_V2 } from './config.js';

// Keep the wire contract at the fetch boundary; components consume plain data.
export function validateFinding(f) {
    const strings = ['slug', 'title', 'url', 'source', 'date_added', 'updated_at', 'note'];
    if (!f || !Number.isInteger(f.id) || strings.some(k => typeof f[k] !== 'string') ||
        !f.slug || !Array.isArray(f.topics) || f.topics.some(t => typeof t !== 'string') ||
        !Array.isArray(f.referenced_insights) || f.referenced_insights.some(s => typeof s !== 'string') ||
        !Array.isArray(f.referenced_events) || f.referenced_events.some(e =>
            !e || !Number.isInteger(e.id) || typeof e.slug !== 'string' || !e.slug || typeof e.title !== 'string')) {
        throw new Error('Invalid finding response');
    }
    return f;
}

async function readJson(path, signal) {
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    if (signal?.aborted) ctrl.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try {
        const response = await fetch(`${API_V2}${path}`, { signal: ctrl.signal });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

export async function fetchFindings(signal) {
    const data = await readJson('/findings', signal);
    if (!data || !Array.isArray(data.findings) || !Array.isArray(data.topics) ||
        data.topics.some(t => typeof t !== 'string') || data.total !== data.findings.length) {
        throw new Error('Invalid findings collection');
    }
    data.findings.forEach(validateFinding);
    if (new Set(data.findings.map(f => f.slug)).size !== data.findings.length) {
        throw new Error('Duplicate finding slug');
    }
    return data;
}

export async function fetchFinding(slug, signal) {
    const data = await readJson(`/findings/${encodeURIComponent(slug)}`, signal);
    const finding = validateFinding(data?.finding);
    if (finding.slug !== slug) throw new Error('Finding slug does not match request');
    return finding;
}

export function sourceUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
}
