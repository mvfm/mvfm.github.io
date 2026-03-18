// ── Config ────────────────────────────────────────────────────────────────────
const _isLocal = window.location.hostname === 'localhost' ||
                 window.location.hostname === '127.0.0.1';
export const ENDPOINT = (_isLocal ? 'http://localhost:8080' : 'https://mvfm.pythonanywhere.com') + '/api/beacon';
const FLUSH_INTERVAL_MS = 5000;
const MAX_PENDING = 50;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_RETRY_BATCHES = 10;

// ── Session ID ────────────────────────────────────────────────────────────────
export function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function getOrCreateSessionId() {
  let id = sessionStorage.getItem('analytics_session_id');
  if (!id) {
    id = generateSessionId();
    sessionStorage.setItem('analytics_session_id', id);
  }
  return id;
}
const _sessionId = getOrCreateSessionId();

// ── State ─────────────────────────────────────────────────────────────────────
let _pendingQueue = [];
let _retryQueue   = [];
let _intervalId   = null;

// ── Public API ────────────────────────────────────────────────────────────────
export function track(eventName, properties = {}) {
  _pendingQueue.push({
    session_id: _sessionId,
    event:      eventName,
    properties,
    ts:         Date.now(),
  });
  if (_pendingQueue.length >= MAX_PENDING) {
    flushAll();
  }
}

// ── Interval Management ────────────────────────────────────────────────────────
function startInterval() {
  if (_intervalId !== null) return;
  _intervalId = setInterval(flushAll, FLUSH_INTERVAL_MS);
}

function stopInterval() {
  if (_intervalId === null) return;
  clearInterval(_intervalId);
  _intervalId = null;
}

async function flushAll() {
  await flushRetry();
  await flushPending();
}

// ── Test helpers (always exported — tree-shaking not needed for vanilla JS) ───
export function _reset() {
  _pendingQueue = [];
  _retryQueue   = [];
  stopInterval();
}
export function _getPendingQueue()           { return _pendingQueue; }
export function _getRetryQueue()             { return _retryQueue; }
export function _seedRetryQueue(entries)     { _retryQueue = entries; }
export function _startInterval()             { startInterval(); }
export function _stopInterval()              { stopInterval(); }

// ── Network ───────────────────────────────────────────────────────────────────
/**
 * Send a batch of events to the backend.
 * Returns a promise that resolves to:
 *   { ok: true }                 — 2xx response
 *   { ok: false, retry: false }  — 4xx (permanent error, drop)
 *   { ok: false, retry: true }   — 5xx or network error (should retry)
 */
async function sendBatch(events) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body:   JSON.stringify({ events }),
    });
    if (res.ok)               return { ok: true };
    if (res.status >= 400 && res.status < 500) return { ok: false, retry: false };
    return { ok: false, retry: true };
  } catch {
    return { ok: false, retry: true };
  }
}

/**
 * Move the pending queue into a batch and send it.
 * If the send fails with retry:true, the batch is added to the retry queue.
 * If the retry queue exceeds MAX_RETRY_BATCHES, the oldest entry is dropped.
 */
async function flushPending() {
  if (_pendingQueue.length === 0) return;
  const batch = _pendingQueue.splice(0);
  const result = await sendBatch(batch);
  if (!result.ok && result.retry) {
    if (_retryQueue.length >= MAX_RETRY_BATCHES) {
      _retryQueue.shift(); // drop oldest
    }
    _retryQueue.push({ events: batch, attempts: 1 });
  }
}

export async function _flushNow() {
  await flushPending();
}

/**
 * Process all retry queue entries.
 * Each entry is sent as a separate fetch request.
 * - Success: remove the entry from the retry queue.
 * - 4xx: remove the entry (permanent failure).
 * - 5xx / network error: increment attempts; if attempts >= MAX_RETRY_ATTEMPTS, remove.
 */
async function flushRetry() {
  // Snapshot current entries (new ones added by flushPending later should not be processed now)
  const entries = _retryQueue.splice(0);
  const remaining = [];
  for (const entry of entries) {
    const result = await sendBatch(entry.events);
    if (result.ok) {
      // Sent successfully — discard
      continue;
    }
    if (!result.retry) {
      // 4xx — permanent failure, discard
      continue;
    }
    // 5xx or network error
    entry.attempts += 1;
    if (entry.attempts < MAX_RETRY_ATTEMPTS) {
      remaining.push(entry);
    }
    // If attempts >= MAX_RETRY_ATTEMPTS: drop permanently
  }
  // Put remaining entries back at the front of the retry queue
  _retryQueue = [...remaining, ..._retryQueue];
}

export async function _flushRetryNow() {
  await flushRetry();
}

// ── Beacon path ───────────────────────────────────────────────────────────────
function beaconBatch(events) {
  if (events.length === 0) return;
  const payload = JSON.stringify({ events });
  const blob    = new Blob([payload], { type: 'application/json' });
  if (typeof navigator.sendBeacon !== 'function') {
    fetch(ENDPOINT, {
      method:    'POST',
      body:      payload,
      keepalive: true,
    });
    return;
  }
  const sent = navigator.sendBeacon(ENDPOINT, blob);
  if (!sent) {
    // sendBeacon returned false — fall back to keepalive fetch (fire and forget)
    fetch(ENDPOINT, {
      method:    'POST',
      body:      payload,
      keepalive: true,
    });
    // No .then() / .catch() / await — fire and forget
  }
}

function beaconAll() {
  // Beacon pending queue
  const pending = _pendingQueue.splice(0);
  beaconBatch(pending);

  // Beacon each retry entry separately
  const retrying = _retryQueue.splice(0);
  for (const entry of retrying) {
    beaconBatch(entry.events);
  }
}

// ── Lifecycle listeners ───────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopInterval();
    beaconAll();
  } else {
    startInterval();
  }
});

window.addEventListener('pagehide', () => {
  beaconAll();
  // fire-and-forget — do NOT use async/await or .then() here
});

// Auto-start the interval on module load
startInterval();

// Fire the initial page_view on module load
track('page_view', { route: window.location.pathname });
