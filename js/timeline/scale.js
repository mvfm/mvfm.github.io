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
export function createScale(events, { alpha = ALPHA } = {}) {
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

  return { n, posOf, _positions: positions, _times: times, _domain: { t0, t1 } };
}
