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
    this._clearExit();
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
    this._animateOpen();
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

  _motionEnabled() {
    return !this.opts.reducedMotion && typeof this.el?.animate === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  _animateOpen() {
    if (!this._motionEnabled()) return;
    const timing = { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' };
    this.el.animate([
      { opacity: 0, transform: 'scale(.985)' },
      { opacity: 1, transform: 'scale(1)' },
    ], timing);
    const rise = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }];
    this.el.querySelector('.ait-overlay-mark').animate(rise, timing);
    for (const child of this._scroll.children) {
      child.animate(rise, { ...timing, delay: child.matches('.ait-quote-speaker') ? 120 : 60 });
    }
  }

  _clearExit() {
    this._exit?.remove();
    this._exit = null;
  }

  _clearPage() {
    this._outgoing?.remove();
    this._outgoing = null;
    this.el?.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
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
    this._clearPage();
    const motion = this._motionEnabled();
    // A non-interactive copy preserves the outgoing text's fitted size and scroll
    // position while the live content, link and announcement update immediately.
    let outgoing;
    if (motion) {
      outgoing = this._scroll.cloneNode(true);
      outgoing.setAttribute('aria-hidden', 'true');
      outgoing.inert = true;
      Object.assign(outgoing.style, {
        position: 'absolute', pointerEvents: 'none',
        top: `${this._scroll.offsetTop}px`, left: `${this._scroll.offsetLeft}px`,
        width: `${this._scroll.offsetWidth}px`, height: `${this._scroll.offsetHeight}px`,
      });
      this.el.appendChild(outgoing);
      outgoing.scrollTop = this._scroll.scrollTop;
      this._outgoing = outgoing;
    }
    this.index = (this.index + delta + n) % n;
    this._render();
    if (motion) {
      const x = Math.sign(delta) * 8;
      const timing = { duration: 180, easing: 'ease-out' };
      outgoing.animate([{ opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: `translateX(${-x}px)` }], timing)
        .finished.then(() => outgoing.remove(), () => outgoing.remove());
      this._scroll.animate([{ opacity: 0, transform: `translateX(${x}px)` },
        { opacity: 1, transform: 'translateX(0)' }], timing);
    }
    this.opts.onNav?.({ index: this.index, item: this.opts.items[this.index] });
  }

  close({ restoreFocus = true, animate = true } = {}) {
    if (!this.el) return;
    this._clearPage();
    if (animate && this._motionEnabled()) {
      const exit = this.el.cloneNode(true);
      exit.classList.replace('ait-overlay', 'ait-overlay-exit');
      exit.removeAttribute('role');
      exit.removeAttribute('tabindex');
      exit.setAttribute('aria-hidden', 'true');
      exit.inert = true;
      this.opts.host.appendChild(exit);
      exit.querySelector('.ait-overlay-scroll').scrollTop = this._scroll.scrollTop;
      this._exit = exit;
      exit.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out' })
        .finished.then(() => exit.remove(), () => exit.remove());
    }
    document.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('resize', this._onResize);
    this._onOutside = null;
    this.el.remove();
    this.el = null;
    this.opts.host.classList.remove('has-overlay');
    if (restoreFocus && this._returnFocus?.isConnected) this._returnFocus.focus({ preventScroll: true });
    this.opts.onClose?.();
  }

  destroy() {
    this.close({ restoreFocus: false, animate: false });
    this._clearExit();
  }
}
