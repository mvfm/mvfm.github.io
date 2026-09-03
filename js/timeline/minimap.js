const LANE_LABEL_ABBR = { research: 'R', industry: 'I', 'pop culture': 'P' };

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
    this.focus = { f0: 0, f1: 1 };
    this.current = 0;
    this._dpr = Math.min(2, window.devicePixelRatio || 1);
    this._raf = 0;
    this._destroyed = false;
    this._drag = null;              // { mode:'body'|'edge0'|'edge1'|'playhead', startX, startF }
    this._laneLabelWidth = 16;
    this._lastScrub = -Infinity;   // timestamp of last playhead-drag onScrub (throttle); -Inf = none yet

    this._onPointerDown = e => this._pointerDown(e);
    this._onPointerMove = e => this._pointerMove(e);
    this._onPointerUp = e => this._pointerUp(e);
    this._onWheel = e => this._wheel(e);
    this._onKey = e => this._key(e);

    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    // slider wrapper for a11y (created by the orchestrator around the canvas;
    // if present, wire arrow keys)
    this.slider = this.canvas.closest('[role="slider"]');
    if (this.slider) this.slider.addEventListener('keydown', this._onKey);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.canvas);
    this._resize();               // sets size + first draw
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
    this._raf = requestAnimationFrame(() => { this._raf = 0; if (!document.hidden) this.draw(); });
  }

  // ----- geometry helpers -----
  _plotX(f) { return this._laneLabelWidth + f * (this._w - this._laneLabelWidth); }
  _fracAtX(x) { return (x - this._laneLabelWidth) / (this._w - this._laneLabelWidth); }
  _laneRect(gi) {
    const labelStrip = 14;
    const usable = this._h - labelStrip;
    const laneH = usable / this.groups.length;
    return { y: gi * laneH, h: laneH - 1, labelStrip };
  }

  draw() {
    const { ctx, palette } = this;
    ctx.save();
    ctx.scale(this._dpr, this._dpr);
    ctx.clearRect(0, 0, this._w, this._h);

    // 1. era bands
    const dom = this.scale.domain;
    const span = dom.t1 - dom.t0 || 1;
    this.eras.forEach((era, k) => {
      const a = (parseFloat(era.start_date.year) - dom.t0) / span;
      const bEnd = era.end_date ? parseFloat(era.end_date.year) : dom.t1;
      const b = (bEnd - dom.t0) / span;
      ctx.fillStyle = k % 2 ? palette.eraBandB : palette.eraBandA;
      ctx.fillRect(this._plotX(Math.max(0, a)), 0, this._plotX(Math.min(1, b)) - this._plotX(Math.max(0, a)), this._h - 14);
      ctx.fillStyle = palette.laneLabel;
      ctx.font = '9px system-ui, sans-serif';
      if (b - a > 0.12) ctx.fillText(era.text?.headline || '', this._plotX(Math.max(0, a)) + 3, 10);
    });

    // 2. density per lane
    ctx.lineWidth = 1;
    for (let i = 0; i < this.scale.n; i++) {
      const gi = Math.max(0, this.groups.indexOf(this.opts.groupOf(i)));
      const { y, h } = this._laneRect(gi);
      const x = Math.round(this._plotX(this.scale.posOf(i))) + 0.5;
      ctx.strokeStyle = palette.density;
      ctx.globalAlpha = 0.16;
      ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + h - 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 3. lane labels
    ctx.fillStyle = palette.laneLabel;
    ctx.font = '8px system-ui, sans-serif';
    this.groups.forEach((g, gi) => {
      const { y, h } = this._laneRect(gi);
      ctx.fillText(LANE_LABEL_ABBR[g] || g[0].toUpperCase(), 3, y + h / 2 + 3);
    });

    // 4. focus window
    const x0 = this._plotX(this.focus.f0), x1 = this._plotX(this.focus.f1);
    ctx.fillStyle = palette.focusWindow;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(x0, 2, x1 - x0, this._h - 18);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.focusWindow;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, 2, x1 - x0, this._h - 18);

    // 5. playhead
    const px = this._plotX(this.scale.posOf(Math.round(this.current)));
    ctx.strokeStyle = palette.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const clampedPx = Math.max(x0, Math.min(x1, px));
    ctx.moveTo(clampedPx, 0); ctx.lineTo(clampedPx, this._h - 14); ctx.stroke();

    // 5b. out-of-window chevron — pinned at the nearer edge when current is outside
    if (px < x0 || px > x1) {
      const my = (this._h - 14) / 2, s = 4;
      ctx.fillStyle = palette.playhead;
      ctx.beginPath();
      if (px < x0) { ctx.moveTo(x0, my); ctx.lineTo(x0 + s, my - s); ctx.lineTo(x0 + s, my + s); }
      else { ctx.moveTo(x1, my); ctx.lineTo(x1 - s, my - s); ctx.lineTo(x1 - s, my + s); }
      ctx.closePath(); ctx.fill();
    }

    // 6. year labels — up to 6 "nice" ticks across the domain
    ctx.fillStyle = palette.yearLabel;
    ctx.font = '9px system-ui, sans-serif';
    const ticks = niceYears(dom.t0, dom.t1, 6);
    ticks.forEach(yr => {
      const f = (yr - dom.t0) / span;
      ctx.fillText(String(yr), this._plotX(f) - 10, this._h - 3);
    });

    ctx.restore();
  }

  // ----- interaction -----
  _hitMode(x) {
    const x0 = this._plotX(this.focus.f0), x1 = this._plotX(this.focus.f1);
    const grab = 8;
    if (Math.abs(x - x0) <= grab) return 'edge0';
    if (Math.abs(x - x1) <= grab) return 'edge1';
    const rawPx = this._plotX(this.scale.posOf(Math.round(this.current)));
    const playPx = Math.max(x0, Math.min(x1, rawPx));   // clamped x, matching what's drawn
    if (Math.abs(x - playPx) <= 6) return 'playhead';
    if (x > x0 && x < x1) return 'body';
    return 'jump';
  }

  _pointerDown(e) {
    const x = e.offsetX;
    const mode = this._hitMode(x);
    if (mode === 'jump') {
      const idx = Math.round(this.scale.indexAtFrac(this._fracAtX(x)));
      this.opts.onScrub?.(idx);
      return;
    }
    this._drag = { mode, startX: x, startFocus: { ...this.focus } };
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  _pointerMove(e) {
    if (!this._drag) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (this._drag.mode === 'playhead') {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - this._lastScrub < 60) return;   // throttle continuous scrub
      this._lastScrub = now;
      this.opts.onScrub?.(Math.round(this.scale.indexAtFrac(this._fracAtX(x))));
      return;                                   // never move the focus window in this mode
    }
    const df = this._fracAtX(x) - this._fracAtX(this._drag.startX);
    let { f0, f1 } = this._drag.startFocus;
    if (this._drag.mode === 'body') { f0 += df; f1 += df; }
    else if (this._drag.mode === 'edge0') { f0 += df; }
    else if (this._drag.mode === 'edge1') { f1 += df; }
    const win = this.scale.clampWindow({ f0, f1 });
    this.focus = win;
    this._invalidate();
    this.opts.onZoom?.(win);
  }

  _pointerUp() { this._drag = null; }

  _wheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const cursorF = this._fracAtX((e.clientX ?? (rect.left + this._w / 2)) - rect.left);
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;   // down = zoom out
    let { f0, f1 } = this.focus;
    f0 = cursorF + (f0 - cursorF) * factor;
    f1 = cursorF + (f1 - cursorF) * factor;
    const win = this.scale.clampWindow({ f0, f1 });
    this.focus = win;
    this._invalidate();
    this.opts.onZoom?.(win);
  }

  _key(e) {
    if (e.key === 'ArrowRight') { this.opts.onScrub?.(Math.min(this.scale.n - 1, Math.round(this.current) + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { this.opts.onScrub?.(Math.max(0, Math.round(this.current) - 1)); e.preventDefault(); }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    if (this.slider) this.slider.removeEventListener('keydown', this._onKey);
    this._ro.disconnect();
  }
}

function niceYears(t0, t1, count) {
  const span = t1 - t0;
  if (span <= 0) return [Math.round(t0)];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = [];
  for (let y = Math.ceil(t0 / step) * step; y <= t1; y += step) out.push(Math.round(y));
  return out.length > 7 ? out.slice(0, 7) : out;   // spec: 4–7 ticks
}
