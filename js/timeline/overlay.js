// Generic panel that opens over a host element (the timeline card). Content and link come from
// caller-supplied renderers, so other kinds of overlay (e.g. a glossary) can
// reuse the shell: dialog semantics, pager, keys, focus and outside click.

const MIN_FIT_PX = 17;

export class MediaOverlay {
  constructor(opts) {
    this.opts = opts;
    this.index = 0;
    this.el = null;
    this._returnFocus = null;
    this._onOutside = null;
  }

  get isOpen() { return !!this.el; }

  open(returnFocusEl = null) {
    if (this.el) return;
    const { host, items, label, caption = '', className = '' } = this.opts;
    this._returnFocus = returnFocusEl;
    this.index = 0;

    const el = document.createElement('div');
    el.className = `ait-overlay ${className}`.trim();
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
    el.tabIndex = -1;

    const mark = document.createElement('span');
    mark.className = 'ait-overlay-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '“';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ait-overlay-close';
    close.setAttribute('aria-label', `Close ${label.toLowerCase()}`);
    close.textContent = '×';

    const cap = document.createElement('div');
    cap.className = 'ait-overlay-caption';
    cap.textContent = caption;
    cap.hidden = !caption;

    const scroll = document.createElement('div');
    scroll.className = 'ait-overlay-scroll';

    const foot = document.createElement('div');
    foot.className = 'ait-overlay-foot';
    const prev = this._button('ait-overlay-prev', 'Previous', '❮');
    const dots = document.createElement('span');
    dots.className = 'ait-overlay-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < items.length; i++) {
      const d = document.createElement('span');
      d.className = 'ait-overlay-dot';
      dots.appendChild(d);
    }
    const count = document.createElement('span');
    count.className = 'ait-overlay-count';
    count.setAttribute('aria-live', 'polite');
    const next = this._button('ait-overlay-next', 'Next', '❯');
    const link = document.createElement('a');
    link.className = 'ait-overlay-link';
    foot.append(prev, dots, count, next, link);

    const multi = items.length > 1;
    prev.hidden = next.hidden = count.hidden = dots.hidden = !multi;

    el.append(mark, cap, close, scroll, foot);
    this.el = el;
    this._scroll = scroll; this._count = count; this._dots = dots; this._link = link;

    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.ait-overlay-close')) { this.close(); return; }
      if (ev.target.closest('.ait-overlay-prev')) { this.step(-1); return; }
      if (ev.target.closest('.ait-overlay-next')) { this.step(1); return; }
      if (ev.target.closest('.ait-overlay-link')) this.opts.onLinkClick?.(items[this.index], ev);
    });
    // Arrow keys page the overlay, and never bubble: the timeline listens on an
    // ancestor and would otherwise move to another entry underneath us.
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); this.close(); }
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault(); ev.stopPropagation();
        this.step(ev.key === 'ArrowRight' ? 1 : -1);
      }
    });
    // Scrolling a long quote must not page the timeline (its wheel handler is on an ancestor).
    el.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });

    this._onOutside = (ev) => {
      if (!this.el || this.el.contains(ev.target) || this._returnFocus?.contains(ev.target)) return;
      this.close({ restoreFocus: false });
    };
    document.addEventListener('pointerdown', this._onOutside, true);
    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);

    host.appendChild(el);
    host.classList.add('has-overlay');
    this._render();
    el.focus({ preventScroll: true });
    this.opts.onOpen?.({ count: items.length });
  }

  _button(cls, label, glyph) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    return b;
  }

  _render() {
    const { items, renderItem, linkFor } = this.opts;
    const item = items[this.index];
    this._scroll.replaceChildren(renderItem(item, this.index));
    this._scroll.scrollTop = 0;
    this._count.textContent = `Quote ${this.index + 1} of ${items.length}`;
    [...this._dots.children].forEach((d, i) => d.classList.toggle('active', i === this.index));
    const target = linkFor ? linkFor(item) : null;
    this._link.hidden = !target;
    if (target) { this._link.href = target.href; this._link.textContent = target.label; }
    this._fit();
  }

  // Shrink the text a step at a time until it fits without a scrollbar. Stops at a
  // readable floor (MIN_FIT_PX); anything longer than that scrolls as a last resort.
  _fit() {
    const scroll = this._scroll;
    const text = scroll.querySelector('[data-fit]');
    if (!text) return;
    text.style.fontSize = '';
    let size = parseFloat(getComputedStyle(text).fontSize);
    while (scroll.scrollHeight > scroll.clientHeight + 1 && size > MIN_FIT_PX) {
      size = Math.max(MIN_FIT_PX, size - 1);
      text.style.fontSize = `${size}px`;
    }
  }

  step(delta) {
    const n = this.opts.items.length;
    if (!this.el || n < 2) return;
    this.index = (this.index + delta + n) % n;
    this._render();
    this.opts.onNav?.({ index: this.index, item: this.opts.items[this.index] });
  }

  close({ restoreFocus = true } = {}) {
    if (!this.el) return;
    document.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('resize', this._onResize);
    this._onOutside = null;
    this.el.remove();
    this.el = null;
    this.opts.host.classList.remove('has-overlay');
    if (restoreFocus && this._returnFocus?.isConnected) this._returnFocus.focus({ preventScroll: true });
    this.opts.onClose?.();
  }

  destroy() { this.close({ restoreFocus: false }); }
}
