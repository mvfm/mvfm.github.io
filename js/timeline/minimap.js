// Layout bands, measured up from the bottom of the strip.
const OVERVIEW_H = 12;   // full-range strip with the draggable focus window
const YEAR_H = 13;       // time-axis tick labels
const NAME_H = 15;       // entry-headline labels (only when markers are far enough apart)
const LABEL_MIN_GAP = 108; // px between labelled markers
const AXIS_LABEL_GAP = 30;  // min px between time-axis tick labels (widened per-label by text width)

const pad2 = n => String(n).padStart(2, '0');

// ISO-ish date for the hover tooltip: "1957", "1957-08", or "1957-08-23"
// (precision follows what the event actually provides)
function fmtIsoDate(d) {
  if (!d) return '';
  const y = Number(d.year);
  if (!Number.isFinite(y)) return '';
  const m = Number(d.month);
  if (!Number.isFinite(m) || m < 1 || m > 12) return String(y);
  const day = Number(d.day);
  return Number.isFinite(day) && day >= 1 ? `${y}-${pad2(m)}-${pad2(day)}` : `${y}-${pad2(m)}`;
}

// Adaptive time axis: as the window narrows, step from years → months → days.
// Labels are ISO-ish ("1997", "1997-04", "1997-04-10"). Times are decimal years
// in the scale's own model: year + (m-1)/12 + (day-1)/365.
// Returns [{ tt, label, strong }] for the visible span [t0, t1].
function axisTicks(t0, t1) {
  const span = t1 - t0;
  const out = [];
  if (!(span > 0)) return out;

  if (span > 8) {
    niceYears(Math.floor(t0), Math.ceil(t1), 6).forEach(y => out.push({ tt: y, label: String(y), strong: true }));
  } else if (span > 0.66) {
    const step = [1, 2, 3, 6].find(s => (span * 12) / s <= 7) || 6;
    for (let y = Math.floor(t0) - 1; y <= Math.ceil(t1) + 1; y++) {
      for (let m = 1; m <= 12; m += 1) {
        if ((m - 1) % step !== 0) continue;
        const tt = y + (m - 1) / 12;
        if (tt < t0 || tt > t1) continue;
        out.push({ tt, label: `${y}-${pad2(m)}`, strong: m === 1 });
      }
    }
  } else {
    const step = [1, 2, 5, 10, 15].find(s => (span * 365) / s <= 7) || 15;
    for (let y = Math.floor(t0) - 1; y <= Math.ceil(t1) + 1; y++) {
      for (let m = 1; m <= 12; m += 1) {
        const dim = new Date(y, m, 0).getDate();   // real days in this month
        for (let d = 1; d <= dim; d += 1) {
          if ((d - 1) % step !== 0) continue;
          const tt = y + (m - 1) / 12 + (d - 1) / 365;
          if (tt < t0 || tt > t1) continue;
          out.push({ tt, label: `${y}-${pad2(m)}-${pad2(d)}`, strong: d === 1 });
        }
      }
    }
  }
  return out;
}

export class Minimap {
  constructor(canvasEl, opts) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.opts = opts;
    this.scale = opts.scale;
    this.groups = opts.groups;
    this.eras = opts.eras || [];
    this.palette = opts.palette;
    this.reducedMotion = opts.reducedMotion;
    this.labelOf = opts.labelOf || (() => '');
    this.focus = { f0: 0, f1: 1 };
    this.current = 0;
    this._dpr = Math.min(2, window.devicePixelRatio || 1);
    this._raf = 0;
    this._destroyed = false;
    this._drag = null;
    this._laneLabelWidth = 16;
    this._lastScrub = -Infinity;
    this._hoverIdx = -1;

    // hover tooltip — a plain DOM node next to the canvas
    this._tip = document.createElement('div');
    this._tip.className = 'ait-minimap-tip';
    this._tip.hidden = true;
    (this.canvas.parentElement || document.body).appendChild(this._tip);

    this._onPointerDown = e => this._pointerDown(e);
    this._onPointerMove = e => this._pointerMove(e);
    this._onPointerUp = e => this._pointerUp(e);
    this._onHover = e => this._hover(e);
    this._onLeave = () => this._hideTip();
    this._onWheel = e => this._wheel(e);
    this._onKey = e => this._key(e);
    // draw() is skipped while the tab/pane is hidden; repaint when it returns
    this._onVis = () => { if (!document.hidden) this._invalidate(); };
    document.addEventListener('visibilitychange', this._onVis);

    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointermove', this._onHover);
    this.canvas.addEventListener('pointerleave', this._onLeave);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.slider = this.canvas.closest('[role="slider"]');
    if (this.slider) this.slider.addEventListener('keydown', this._onKey);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.canvas);
    this._resize();
  }

  setScale(scale) { this.scale = scale; this.current = Math.min(this.current, scale.n - 1); this._invalidate(); }
  setFocus(win) { this.focus = { f0: win.f0, f1: win.f1 }; this._invalidate(); }
  setCurrent(i) { this.current = i; this._invalidate(); }

  _debug() {
    const r = this.canvas.getBoundingClientRect();
    return { w: r.width, h: r.height, dpr: this._dpr, focus: { ...this.focus }, current: this.current, laneCount: this.groups.length };
  }

  _resize() {
    if (this._destroyed) return;
    const r = this.canvas.getBoundingClientRect();
    this._w = Math.max(1, r.width);
    this._h = Math.max(1, r.height);
    this.canvas.width = Math.round(this._w * this._dpr);
    this.canvas.height = Math.round(this._h * this._dpr);
    this._invalidate();
  }

  _invalidate() {
    if (this._destroyed || this._raf) return;
    // draw() is on-demand (called from setFocus/setCurrent/resize/interaction),
    // not a loop, so paint even when the tab is hidden — skipping the first
    // paint leaves a blank canvas until the user interacts.
    this._raf = requestAnimationFrame(() => { this._raf = 0; if (!this._destroyed) this.draw(); });
  }

  // ----- geometry -----
  get _plotW() { return this._w - this._laneLabelWidth; }
  get _lanesH() { return this._h - OVERVIEW_H - YEAR_H - NAME_H; }
  // detail transform: the focus window maps across the full plot width
  _plotX(f) {
    const { f0, f1 } = this.focus;
    return this._laneLabelWidth + ((f - f0) / ((f1 - f0) || 1)) * this._plotW;
  }
  _fracAtX(x) {
    const { f0, f1 } = this.focus;
    return f0 + ((x - this._laneLabelWidth) / (this._plotW || 1)) * (f1 - f0);
  }
  // overview transform: the whole [0,1] range maps across the full plot width
  _ovX(f) { return this._laneLabelWidth + f * this._plotW; }
  _ovFracAtX(x) { return (x - this._laneLabelWidth) / (this._plotW || 1); }
  _laneRect(gi) {
    const laneH = this._lanesH / this.groups.length;
    return { y: gi * laneH, h: laneH - 1 };
  }

  draw() {
    const { ctx, palette } = this;
    const W = this._w, lanesH = this._lanesH;
    if (!W || W < 24 || !this._h || !this.scale || !this.scale.n) return;
    ctx.save();
    ctx.scale(this._dpr, this._dpr);
    ctx.clearRect(0, 0, W, this._h);

    const dom = this.scale.domain;
    const tspan = dom.t1 - dom.t0 || 1;
    const times = this.scale._times || [];
    // global fraction -> approximate calendar year, via the two visible endpoints
    const yearAtFrac = f => {
      const i = Math.max(0, Math.min(this.scale.n - 1, Math.round(this.scale.indexAtFrac(f))));
      return Math.floor(times[i] ?? dom.t0);
    };
    // global fraction -> decimal time, interpolating the (warped) index axis
    const timeAtFrac = f => {
      if (!times.length) return dom.t0;
      const fi = Math.max(0, Math.min(this.scale.n - 1, this.scale.indexAtFrac(f)));
      const lo = Math.floor(fi), hi = Math.min(this.scale.n - 1, lo + 1);
      const a = times[lo] ?? dom.t0, b = times[hi] ?? a;
      return a + (fi - lo) * (b - a);
    };
    // decimal time -> global fraction, the inverse of the warp (binary search on times)
    const fracAtTime = tt => {
      const n = this.scale.n;
      if (!n) return 0;
      if (tt <= times[0]) return 0;
      if (tt >= times[n - 1]) return 1;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= tt) lo = m; else hi = m; }
      const denom = (times[hi] - times[lo]) || 1;
      const fi = lo + (tt - times[lo]) / denom;
      return this.scale.posOf(lo) + (fi - lo) * (this.scale.posOf(hi) - this.scale.posOf(lo));
    };

    // 1. era bands (clipped to the detail viewport)
    this.eras.forEach((era, k) => {
      const ay = parseFloat(era.start_date.year);
      const by = era.end_date ? parseFloat(era.end_date.year) : dom.t1;
      // era boundaries are calendar years; place them by their global fraction
      const af = clamp01((ay - dom.t0) / tspan), bf = clamp01((by - dom.t0) / tspan);
      const x0 = this._plotX(af), x1 = this._plotX(bf);
      if (x1 < this._laneLabelWidth || x0 > W) return;
      ctx.fillStyle = k % 2 ? palette.eraBandB : palette.eraBandA;
      ctx.fillRect(Math.max(this._laneLabelWidth, x0), 0, Math.min(W, x1) - Math.max(this._laneLabelWidth, x0), lanesH);
      if (x1 - x0 > 90) {
        ctx.fillStyle = palette.laneLabel;
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillText(era.text?.headline || '', Math.max(this._laneLabelWidth + 3, x0 + 3), 10);
      }
    });

    // 2. lane backgrounds + names (very faint per-group tint)
    const laneColors = palette.laneColors || {};
    ctx.font = '9px system-ui, sans-serif';
    this.groups.forEach((g, gi) => {
      const { y, h } = this._laneRect(gi);
      const col = laneColors[g] || palette.density;
      ctx.globalAlpha = 0.06; ctx.fillStyle = col;
      ctx.fillRect(0, y, W, h);
      // legibility backing for the name
      const nw = ctx.measureText(g).width + 6;
      ctx.globalAlpha = 0.7; ctx.fillStyle = '#fff';
      ctx.fillRect(0, y + h / 2 - 6, nw, 12);
      ctx.globalAlpha = 0.95; ctx.fillStyle = col;
      ctx.fillText(g, 3, y + h / 2 + 3.5);
    });
    ctx.globalAlpha = 1;

    // 3. density per lane (visible markers only), tinted by group
    ctx.lineWidth = 1;
    for (let i = 0; i < this.scale.n; i++) {
      const f = this.scale.posOf(i);
      if (f < this.focus.f0 || f > this.focus.f1) continue;
      const g = this.opts.groupOf(i);
      const gi = Math.max(0, this.groups.indexOf(g));
      const { y, h } = this._laneRect(gi);
      const x = Math.round(this._plotX(f)) + 0.5;
      const active = i === Math.round(this.current);
      ctx.strokeStyle = active ? palette.playhead
        : (palette.marker || laneColors[g] || palette.density);
      ctx.globalAlpha = active ? 1 : 0.45;
      ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + h - 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 4. entry-headline labels — only where markers are far enough apart
    const nameY = lanesH + NAME_H - 4;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = palette.yearLabel;
    let lastLabelX = -Infinity;
    for (let i = 0; i < this.scale.n; i++) {
      const f = this.scale.posOf(i);
      if (f < this.focus.f0 || f > this.focus.f1) continue;
      const x = this._plotX(f);
      if (x - lastLabelX < LABEL_MIN_GAP) continue;
      lastLabelX = x;
      const txt = trunc(this.labelOf(i), 22);
      if (txt) { ctx.fillText(txt, Math.min(x, W - ctx.measureText(txt).width - 2), nameY); }
      // little stem
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = palette.yearLabel;
      ctx.beginPath(); ctx.moveTo(x, lanesH); ctx.lineTo(x, lanesH + 4); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 5. time axis — granularity adapts to the zoom (year → month → day)
    const yrRowY = lanesH + NAME_H + YEAR_H - 3;
    const tw0 = timeAtFrac(this.focus.f0), tw1 = timeAtFrac(this.focus.f1);
    const y0 = yearAtFrac(this.focus.f0), y1 = yearAtFrac(this.focus.f1);
    ctx.fillStyle = palette.yearLabel;
    ctx.font = '9px system-ui, sans-serif';
    let lastTickX = -Infinity;
    axisTicks(tw0, tw1).forEach(({ tt, label, strong }) => {
      const x = this._plotX(fracAtTime(tt));
      if (x < this._laneLabelWidth || x > W) return;
      const lw = ctx.measureText(label).width;
      // space labels by their own width so "1997-04-10" never collides with its neighbour
      if (x - lastTickX < Math.max(AXIS_LABEL_GAP, lw + 12)) return;
      lastTickX = x;
      ctx.globalAlpha = strong ? 1 : 0.72;
      const lx = Math.min(Math.max(this._laneLabelWidth, x - lw / 2), W - lw - 2);
      ctx.fillText(label, lx, yrRowY);
      ctx.globalAlpha = 1;
    });

    // 6. playhead (detail)
    const px = this._plotX(this.scale.posOf(Math.round(this.current)));
    ctx.strokeStyle = palette.playhead;
    ctx.lineWidth = 2;
    const cpx = Math.max(this._laneLabelWidth, Math.min(W, px));
    ctx.beginPath(); ctx.moveTo(cpx, 0); ctx.lineTo(cpx, lanesH); ctx.stroke();
    if (px < this._laneLabelWidth || px > W) {
      const my = lanesH / 2, s = 4;
      ctx.fillStyle = palette.playhead;
      ctx.beginPath();
      if (px < this._laneLabelWidth) { ctx.moveTo(this._laneLabelWidth, my); ctx.lineTo(this._laneLabelWidth + s, my - s); ctx.lineTo(this._laneLabelWidth + s, my + s); }
      else { ctx.moveTo(W, my); ctx.lineTo(W - s, my - s); ctx.lineTo(W - s, my + s); }
      ctx.closePath(); ctx.fill();
    }

    // 7. readout (top-right of the lanes area)
    const inView = this.scale.entriesInWindow(this.focus);
    const readout = `${y0 === y1 ? y0 : `${y0}–${y1}`}  ·  ${inView} / ${this.scale.n}`;
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = palette.yearLabel;
    ctx.globalAlpha = 0.85;
    ctx.fillText(readout, W - ctx.measureText(readout).width - 2, 10);
    ctx.globalAlpha = 1;

    // 8. overview strip (full range) with the draggable focus window
    const ovY = this._h - OVERVIEW_H;
    ctx.fillStyle = palette.eraBandA;
    ctx.fillRect(this._laneLabelWidth, ovY, this._plotW, OVERVIEW_H);
    ctx.strokeStyle = palette.density;
    ctx.globalAlpha = 0.4;
    const ovStep = Math.max(1, Math.ceil(this.scale.n / Math.max(1, this._plotW)));
    for (let i = 0; i < this.scale.n; i += ovStep) {
      const x = Math.round(this._ovX(this.scale.posOf(i))) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, ovY + 2); ctx.lineTo(x, ovY + OVERVIEW_H - 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const ox0 = this._ovX(this.focus.f0), ox1 = this._ovX(this.focus.f1);
    ctx.fillStyle = palette.focusWindow;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(ox0, ovY, ox1 - ox0, OVERVIEW_H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.focusWindow;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox0 + 0.75, ovY + 0.75, (ox1 - ox0) - 1.5, OVERVIEW_H - 1.5);
    // playhead tick on the overview
    const opx = this._ovX(this.scale.posOf(Math.round(this.current)));
    ctx.strokeStyle = palette.playhead;
    ctx.beginPath(); ctx.moveTo(opx, ovY); ctx.lineTo(opx, ovY + OVERVIEW_H); ctx.stroke();

    ctx.restore();
  }

  // ----- interaction -----
  _inOverview(y) { return y >= this._h - OVERVIEW_H - 3; }

  _ovHitMode(x) {
    const x0 = this._ovX(this.focus.f0), x1 = this._ovX(this.focus.f1), grab = 7;
    if (Math.abs(x - x0) <= grab) return 'edge0';
    if (Math.abs(x - x1) <= grab) return 'edge1';
    if (x > x0 && x < x1) return 'body';
    return 'ovjump';
  }

  _pointerDown(e) {
    const x = e.offsetX, y = e.offsetY;
    if (this._inOverview(y)) {
      const mode = this._ovHitMode(x);
      if (mode === 'ovjump') {
        // recenter the window on the clicked point
        const w = this.focus.f1 - this.focus.f0;
        const c = this._ovFracAtX(x);
        const win = this.scale.clampWindow({ f0: c - w / 2, f1: c + w / 2 });
        this.focus = win; this._invalidate(); this.opts.onZoom?.(win);
        return;
      }
      this._drag = { mode, ov: true, startX: x, startFocus: { ...this.focus } };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    // detail band: grab the playhead to scrub, otherwise grab anywhere to pan
    // the view — a press that doesn't move falls through to jump-to-entry.
    const rawPx = this._plotX(this.scale.posOf(Math.round(this.current)));
    if (Math.abs(x - Math.max(this._laneLabelWidth, Math.min(this._w, rawPx))) <= 6) {
      this._drag = { mode: 'playhead', startX: x, startFocus: { ...this.focus } };
    } else {
      this._drag = { mode: 'pan', startX: x, startFocus: { ...this.focus }, moved: false };
    }
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  _pointerMove(e) {
    if (!this._drag) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (this._drag.mode === 'playhead') {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - this._lastScrub < 60) return;
      this._lastScrub = now;
      this.opts.onScrub?.(Math.round(this.scale.indexAtFrac(this._fracAtX(x))));
      return;
    }
    if (this._drag.mode === 'pan') {
      const sf = this._drag.startFocus;
      const w = sf.f1 - sf.f0;
      const dfrac = ((x - this._drag.startX) / (this._plotW || 1)) * w;
      if (Math.abs(x - this._drag.startX) > 3) this._drag.moved = true;
      const win = this.scale.clampWindow({ f0: sf.f0 - dfrac, f1: sf.f1 - dfrac });
      this.focus = win;
      this._invalidate();
      this.opts.onZoom?.(win);
      return;
    }
    const df = this._ovFracAtX(x) - this._ovFracAtX(this._drag.startX);
    let { f0, f1 } = this._drag.startFocus;
    if (this._drag.mode === 'body') { f0 += df; f1 += df; }
    else if (this._drag.mode === 'edge0') { f0 += df; }
    else if (this._drag.mode === 'edge1') { f1 += df; }
    const win = this.scale.clampWindow({ f0, f1 });
    this.focus = win;
    this._invalidate();
    this.opts.onZoom?.(win);
  }

  _pointerUp() {
    const d = this._drag;
    this._drag = null;
    if (d && d.mode === 'pan' && !d.moved) {
      // a click, not a drag → jump to the entry under the press
      this.opts.onScrub?.(Math.round(this.scale.indexAtFrac(this._fracAtX(d.startX))));
    }
  }

  _hover(e) {
    if (this._drag) { this._hideTip(); return; }
    const x = e.offsetX, y = e.offsetY;
    if (this._inOverview(y) || y > this._lanesH) { this._hideTip(); return; }
    // nearest visible marker
    let best = -1, bestDx = 7;
    for (let i = 0; i < this.scale.n; i++) {
      const f = this.scale.posOf(i);
      if (f < this.focus.f0 || f > this.focus.f1) continue;
      const dx = Math.abs(this._plotX(f) - x);
      if (dx < bestDx) { bestDx = dx; best = i; }
    }
    if (best < 0) { this._hideTip(); return; }
    if (best !== this._hoverIdx) {
      this._hoverIdx = best;
      const dateText = fmtIsoDate(this.opts.dateOf?.(best))
        || String(Math.floor((this.scale._times || [])[best] ?? 0));
      this._tip.textContent = `${dateText}  ·  ${this.labelOf(best)}`;
      this._tip.hidden = false;
    }
    this._tip.style.left = Math.round(x) + 'px';
    this._tip.style.top = Math.round(this._lanesH + 2) + 'px';
  }

  _hideTip() { this._hoverIdx = -1; if (this._tip) this._tip.hidden = true; }

  _zoomAbout(frac, factor) {
    let { f0, f1 } = this.focus;
    f0 = frac + (f0 - frac) * factor;
    f1 = frac + (f1 - frac) * factor;
    const win = this.scale.clampWindow({ f0, f1 });
    this.focus = win;
    this._invalidate();
    this.opts.onZoom?.(win);
  }

  _wheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX ?? (rect.left + this._w / 2)) - rect.left;
    const y = (e.clientY ?? rect.top) - rect.top;
    const frac = this._inOverview(y) ? this._ovFracAtX(x) : this._fracAtX(x);
    this._zoomAbout(clamp01(frac), e.deltaY > 0 ? 1.15 : 1 / 1.15);
  }

  _key(e) {
    const mid = (this.focus.f0 + this.focus.f1) / 2;
    if (e.key === 'ArrowRight') { this.opts.onScrub?.(Math.min(this.scale.n - 1, Math.round(this.current) + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { this.opts.onScrub?.(Math.max(0, Math.round(this.current) - 1)); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { this._zoomAbout(mid, 1 / 1.4); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { this._zoomAbout(mid, 1.4); e.preventDefault(); }
    else if (e.key === 'Home') { this.opts.onScrub?.(0); e.preventDefault(); }
    else if (e.key === 'End') { this.opts.onScrub?.(this.scale.n - 1); e.preventDefault(); }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointermove', this._onHover);
    this.canvas.removeEventListener('pointerleave', this._onLeave);
    this.canvas.removeEventListener('wheel', this._onWheel);
    if (this.slider) this.slider.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    this._ro.disconnect();
    this._tip?.remove();
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function niceYears(t0, t1, count) {
  const span = t1 - t0;
  if (span <= 0) return [Math.round(t0)];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = [];
  for (let y = Math.ceil(t0 / step) * step; y <= t1; y += step) out.push(Math.round(y));
  return out.length > 7 ? out.slice(0, 7) : out;
}
