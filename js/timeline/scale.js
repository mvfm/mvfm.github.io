// Pure, DOM-free. The minimap's coordinate system.
// No date constants: the axis domain is whatever the current result set spans.

export const ALPHA = 0.6;

export function parseDate(d) {
  if (!d || !Number.isFinite(d.year)) return NaN;
  const m = Number.isFinite(d.month) ? d.month : 1;
  const day = Number.isFinite(d.day) ? d.day : 1;
  return d.year + (m - 1) / 12 + (day - 1) / 365;
}

// events: array in /timeline shape, ALREADY sorted ascending by date.
export function createScale(events, { alpha = ALPHA, eras = [] } = {}) {
  const n = events.length;
  const times = events.map(e => parseDate(e.start_date));
  const t0 = times[0];
  const t1 = times[n - 1];
  const span = t1 - t0;

  const positions = new Array(n);
  if (n === 1) {
    positions[0] = 0;
  } else {
    const eff = span > 0 ? alpha : 1;          // span 0 → pure equal spacing
    const e = 1 / (n - 1);
    positions[0] = 0;
    for (let i = 1; i < n; i++) {
      const g = span > 0 ? (times[i] - times[i - 1]) / span : e;
      const w = eff * e + (1 - eff) * g;
      positions[i] = positions[i - 1] + w;
    }
    // pos[n-1] is already exactly 1 by construction, but clamp float drift:
    positions[n - 1] = 1;
  }

  function posOf(i) {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new RangeError(`posOf(${i}) out of range 0..${n - 1}`);
    return positions[i];
  }

  let dT0 = t0, dT1 = t1;
  for (const era of eras) {
    const a = parseDate(era.start_date), b = parseDate(era.end_date || era.start_date);
    if (Number.isFinite(a)) dT0 = Math.min(dT0, a);
    if (Number.isFinite(b)) dT1 = Math.max(dT1, b);
  }

  const minW = n >= 4 ? 3 / (n - 1) : 1;

  function indexAtFrac(f) {
    if (f <= 0) return 0;
    if (f >= 1) return n - 1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (positions[mid] <= f) lo = mid; else hi = mid;
    }
    const denom = positions[hi] - positions[lo] || 1;
    return lo + (f - positions[lo]) / denom;
  }

  function clampWindow({ f0, f1 }) {
    let a = Math.min(f0, f1), b = Math.max(f0, f1);
    a = Math.max(0, Math.min(1, a));
    b = Math.max(0, Math.min(1, b));
    if (b - a < minW) {
      const mid = (a + b) / 2;
      a = mid - minW / 2; b = mid + minW / 2;
      if (a < 0) { b -= a; a = 0; }
      if (b > 1) { a -= (b - 1); b = 1; }
      a = Math.max(0, a);
    }
    return { f0: a, f1: b };
  }

  const clampIdx = i => Math.max(0, Math.min(n - 1, i));
  function defaultWindow(centerIndex) {
    const c = clampIdx(Math.round(centerIndex));
    return clampWindow({ f0: positions[clampIdx(c - 15)], f1: positions[clampIdx(c + 15)] });
  }

  function entriesInWindow({ f0, f1 }) {
    let k = 0;
    for (let i = 0; i < n; i++) if (positions[i] >= f0 && positions[i] <= f1) k++;
    return k;
  }

  return {
    n, posOf, indexAtFrac, clampWindow, defaultWindow, entriesInWindow,
    domain: { t0: dT0, t1: dT1 },
    _positions: positions, _times: times,
  };
}
