// Pure helpers for the Quotes section. No DOM.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

export const KIND_LABELS = {
    insight: 'Insight', prediction: 'Prediction', warning: 'Warning', vision: 'Vision',
    critique: 'Critique', humor: 'Humor', reflection: 'Reflection',
};

export function kindLabel(kind) {
    return KIND_LABELS[kind] || kind;
}

// quote_date is always YYYY-MM-DD; date_precision says how much of it is real.
export function formatQuoteDate(dateStr, precision) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!m) return '';
    const [, year, month, day] = m;
    if (precision === 'year') return year;
    const name = MONTHS[Number(month) - 1];
    if (!name) return year;
    if (precision === 'month') return `${name} ${year}`;
    const n = Number(day);
    return `${name} ${n}${ordinalSuffix(n)}, ${year}`;
}

// Same ordinal style as the Findings dates ("October 1st, 1950").
function ordinalSuffix(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return 'th';
    return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

// `topics` (list, ANDed) supersedes the legacy single `topic` string; both may be given.
export function filterQuotes(quotes, { speaker = '', topic = '', topics = [], kind = '', query = '' } = {}) {
    const sp = speaker.trim().toLowerCase();
    const tps = [...(topics || []), topic || ''].map(t => String(t).trim().toLowerCase()).filter(Boolean);
    const kd = kind.trim().toLowerCase();
    const q = query.trim().toLowerCase();
    return (quotes || []).filter(item => {
        if (sp && item.speaker.toLowerCase() !== sp) return false;
        if (tps.some(t => !(item.topics || []).includes(t))) return false;
        if (kd && item.kind !== kd) return false;
        if (q && !`${item.text} ${item.speaker} ${item.source_title}`.toLowerCase().includes(q)) return false;
        return true;
    });
}

export function speakersOf(quotes) {
    return [...new Set((quotes || []).map(q => q.speaker))].sort();
}

export function quoteNotes(quote) {
    const notes = [];
    if (quote.verification === 'secondary') notes.push('Secondary source');
    if (quote.is_translation) notes.push('Translation');
    return notes;
}
