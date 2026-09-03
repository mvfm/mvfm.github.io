import { createScale, parseDate } from './scale.js';
import { Stage } from './stage.js';
import { Minimap } from './minimap.js';

const GROUPS = ['research', 'industry', 'pop culture'];
const ZOOM_TRACK_DEBOUNCE = 400;

function resolvePalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  const focus = v('--timeline-focus', v('--clr-accent', '#1baaff'));
  return {
    focusWindow: focus,
    playhead: v('--clr-primary', '#0c2d6b'),
    density: '#556688',
    eraBandA: 'rgba(12,45,107,0.05)',
    eraBandB: 'rgba(12,45,107,0.02)',
    yearLabel: v('--clr-text-muted', '#7c879e'),
    laneLabel: v('--clr-text-muted', '#7c879e'),
  };
}

export class AITimeline {
  constructor(mountEl, opts) {
    this.opts = opts;
    this.mount = mountEl;
    this.mount.innerHTML = '';
    this._listeners = { change: new Set() };
    this._events = [];
    this._slugToIndex = new Map();
    this._current = 0;
    this._focus = { f0: 0, f1: 1 };
    this._scale = null;
    this._destroyed = false;
    this._wheelAccum = 0;
    this._zoomTimer = 0;

    // DOM: stage div + slider-wrapped canvas
    this._stageEl = document.createElement('div');
    this._stageEl.className = 'ait-stage-host';
    this._sliderEl = document.createElement('div');
    this._sliderEl.className = 'ait-minimap-slider';
    this._sliderEl.setAttribute('role', 'slider');
    this._sliderEl.setAttribute('aria-label', 'Timeline position');
    this._sliderEl.tabIndex = 0;
    this._canvasEl = document.createElement('canvas');
    this._canvasEl.className = 'ait-minimap';
    this._sliderEl.appendChild(this._canvasEl);
    this.mount.append(this._stageEl, this._sliderEl);

    this._stage = new Stage(this._stageEl, {
      sanitizeText: opts.sanitizeText,
      colorForTopic: opts.colorForTopic,
      initialsForTopic: opts.initialsForTopic,
      insightArticlesFor: opts.insightArticlesFor,
      reducedMotion: opts.reducedMotion,
      onTextLinkClick: opts.onTextLinkClick,
      onCartClick: opts.onCartClick,
      onCartOptionClick: opts.onCartOptionClick,
      onInsightClick: opts.onInsightClick,
    });

    this._minimap = null;  // built on first setEvents (needs a scale)

    this._onKey = e => {
      if (e.key === 'ArrowRight') { this.goToIndex(this._current + 1, 'next'); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.goToIndex(this._current - 1, 'prev'); e.preventDefault(); }
    };
    this._onWheel = e => {
      if (e.deltaMode !== 0 && Math.abs(e.deltaY) < 1) return;
      this._wheelAccum += e.deltaY;
      const step = 40;
      if (this._wheelAccum > step) { this._wheelAccum = 0; this.goToIndex(this._current + 1, 'next'); e.preventDefault(); }
      else if (this._wheelAccum < -step) { this._wheelAccum = 0; this.goToIndex(this._current - 1, 'prev'); e.preventDefault(); }
    };
    this._stageEl.addEventListener('keydown', this._onKey);
    this._stageEl.addEventListener('wheel', this._onWheel, { passive: false });
  }

  setEvents(data) {
    const prevSlug = this._events[this._current]?.unique_id;
    const events = [...(data.events || [])]
      .map(e => ({ ...e, text: e.text || { text: '' } }))
      .map(e => ({ ...e, unique_id: this.opts.slugify(e.text.headline || '') }));
    // stable sort by date
    events.sort((a, b) => parseDate(a.start_date) - parseDate(b.start_date));
    this._events = events;
    this._slugToIndex = new Map(events.map((e, i) => [e.unique_id, i]));
    this._scale = createScale(events, { eras: data.eras || [] });

    this._current = (prevSlug && this._slugToIndex.has(prevSlug))
      ? this._slugToIndex.get(prevSlug)
      : events.length - 1;
    this._focus = this._scale.defaultWindow(this._current);

    if (!this._minimap) {
      this._minimap = new Minimap(this._canvasEl, {
        scale: this._scale, groups: GROUPS, eras: data.eras || [],
        groupOf: i => this._events[i]?.group || GROUPS[0],
        palette: resolvePalette(), reducedMotion: this.opts.reducedMotion,
        onZoom: win => this._onZoom(win),
        onScrub: idx => this.goToIndex(idx, 'jump'),
      });
    } else {
      this._minimap.opts.groupOf = i => this._events[i]?.group || GROUPS[0];
      this._minimap.opts.eras = data.eras || [];
      this._minimap.eras = data.eras || [];
      this._minimap.opts.palette = resolvePalette();
      this._minimap.palette = this._minimap.opts.palette;
      this._minimap.setScale(this._scale);
    }
    this._minimap.setFocus(this._focus);
    this._minimap.setCurrent(this._current);
    this._sliderEl.setAttribute('aria-valuemin', '0');
    this._sliderEl.setAttribute('aria-valuemax', String(events.length - 1));

    this._stage.show(this._events[this._current], 'initial');
    this._syncSlider();
    queueMicrotask(() => { if (!this._destroyed) this._emitChange(); });
  }

  goToId(slug) {
    if (!this._slugToIndex.has(slug)) return;
    this.goToIndex(this._slugToIndex.get(slug), 'jump');
  }

  goToIndex(i, direction) {
    const n = this._events.length;
    if (!n) return;
    const next = Math.max(0, Math.min(n - 1, Math.round(i)));
    if (next === this._current && direction !== 'initial') return;
    this._current = next;
    this._stage.show(this._events[next], direction);
    // window-follow: keep the playhead inside the focus window
    const p = this._scale.posOf(next);
    if (p < this._focus.f0 || p > this._focus.f1) {
      const w = this._focus.f1 - this._focus.f0;
      let f0 = p - w / 2, f1 = p + w / 2;
      this._focus = this._scale.clampWindow({ f0, f1 });
      this._minimap.setFocus(this._focus);
    }
    this._minimap.setCurrent(next);
    this._syncSlider();
    this._emitChange();
  }

  _onZoom(win) {
    // minimap clamps before emitting; re-clamp defensively (idempotent, no setFocus
    // echo so no feedback loop) so an unvalidated window can't be stored.
    this._focus = this._scale.clampWindow(win);
    clearTimeout(this._zoomTimer);
    this._zoomTimer = setTimeout(() => {
      this.opts.track?.('timeline_zoom', {
        f0: +win.f0.toFixed(4), f1: +win.f1.toFixed(4),
        entries_in_view: this._scale.entriesInWindow(win),
      });
    }, ZOOM_TRACK_DEBOUNCE);
  }

  _syncSlider() {
    this._sliderEl.setAttribute('aria-valuenow', String(this._current));
    this._sliderEl.setAttribute('aria-valuetext', this._events[this._current]?.text?.headline || '');
  }

  getCurrentSlide() { return { data: this._events[this._current] }; }

  on(name, cb) { this._listeners[name]?.add(cb); }
  off(name, cb) { this._listeners[name]?.delete(cb); }
  _emitChange() {
    const e = this._events[this._current];
    if (!e) return;
    const payload = { unique_id: e.unique_id, text: { headline: e.text?.headline || '' } };
    this._listeners.change.forEach(cb => { try { cb(payload); } catch (err) { console.error(err); } });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    clearTimeout(this._zoomTimer);
    this._stageEl.removeEventListener('keydown', this._onKey);
    this._stageEl.removeEventListener('wheel', this._onWheel);
    this._minimap?.destroy();
    this._stage.destroy();
    this.mount.innerHTML = '';
    this._listeners.change.clear();
  }
}
