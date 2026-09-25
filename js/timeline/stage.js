const YT_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function ytId(url) { const m = url && url.match(YT_RE); return m ? m[1] : null; }
function isImage(url) { return /\.(jpe?g|png|gif|webp|svg|avif)(\?|$)/i.test(url || ''); }
function fmtDate(d) {
  if (!d || d.year == null) return '';
  const m = Number(d.month);
  if (!Number.isFinite(m) || m < 1 || m > 12) return String(d.year);
  const day = Number(d.day);
  // match production TimelineJS: "August 1957" / "August 23, 1957"
  return Number.isFinite(day) && day >= 1
    ? `${MONTHS[m - 1]} ${day}, ${d.year}`
    : `${MONTHS[m - 1]} ${d.year}`;
}

import { MediaOverlay } from './overlay.js';

export class Stage {
  constructor(mountEl, opts) {
    this.mount = mountEl;
    this.opts = opts;
    this.mount.classList.add('ait-stage');
    this.mount.setAttribute('role', 'group');
    this.mount.setAttribute('aria-roledescription', 'timeline');
    this.mount.tabIndex = 0;
    // two reusable card slots
    this._cards = [this._makeCard(), this._makeCard()];
    this._cards.forEach(c => this.mount.appendChild(c));
    this._front = 0;
    // rapid-nav coalescing: a single pending hide-timer + a generation token so a
    // late transitionend / timeout from a superseded transition is a no-op
    this._hideTimer = null;
    this._gen = 0;
    this._quoteOverlay = null;
    // one delegated click handler for all overlay interactions
    this._onClick = (ev) => this._handleClick(ev);
    this.mount.addEventListener('click', this._onClick);
    this._onPillKey = (ev) => {
      if (ev.key !== 'Escape') return;
      const group = ev.target.closest('.ait-chips, .ait-finding-chips, .ait-cart');
      const toggle = group?.querySelector('[aria-expanded="true"]');
      if (!toggle) return;
      ev.preventDefault(); ev.stopPropagation();
      toggle.click(); toggle.focus({ preventScroll: true });
    };
    this.mount.addEventListener('keydown', this._onPillKey);
    // live region for a11y
    this._live = document.createElement('p');
    this._live.className = 'ait-sr-only';
    this._live.setAttribute('aria-live', 'polite');
    this.mount.appendChild(this._live);
  }

  _makeCard() {
    const c = document.createElement('article');
    c.className = 'ait-card';
    c.hidden = true;
    return c;
  }

  show(event, direction) {
    // an overlay belongs to the card it was opened on
    this._quoteOverlay?.destroy();
    this._quoteOverlay = null;
    const incoming = this._cards[1 - this._front];
    const outgoing = this._cards[this._front];
    this._renderInto(incoming, event);

    // coalesce rapid nav: cancel any in-flight hide from a superseded transition
    // and invalidate its callbacks (gen guard) before starting a new one
    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    const gen = ++this._gen;

    const reduce = this.opts.reducedMotion || direction === 'initial' || direction === 'jump';
    // never more than 2 nodes: we only ever toggle `hidden` + transition classes
    outgoing.classList.remove('ait-enter', 'ait-enter-prev');
    incoming.hidden = false;
    // a superseded transition (rapid nav / held →) clears its leave-classes only
    // inside the gen-guarded done(); if it was superseded, those stay on the card
    // we now reuse as incoming and it settles at opacity:0. Clear them (and any
    // stale enter-classes, for symmetry) before every path incl. jump/initial/reduce.
    incoming.classList.remove('ait-leave', 'ait-leave-prev', 'ait-enter', 'ait-enter-prev');
    if (reduce) {
      outgoing.hidden = true;
    } else {
      incoming.classList.add(direction === 'prev' ? 'ait-enter-prev' : 'ait-enter');
      // force reflow then clear to animate
      void incoming.offsetWidth;
      incoming.classList.remove('ait-enter', 'ait-enter-prev');
      outgoing.classList.add(direction === 'prev' ? 'ait-leave-prev' : 'ait-leave');
      const done = () => {
        outgoing.removeEventListener('transitionend', done);
        if (gen !== this._gen) return; // superseded by a later show() — no-op
        this._hideTimer = null;
        outgoing.hidden = true;
        outgoing.classList.remove('ait-leave', 'ait-leave-prev');
      };
      outgoing.addEventListener('transitionend', done);
      // safety: if no transitionend (interrupted), hide on next frame batch
      this._hideTimer = setTimeout(done, 400);
    }
    this._front = 1 - this._front;
    this._live.textContent = event.text?.headline || '';
    this.mount.setAttribute('aria-label', `${event.text?.headline || 'Entry'}`);
  }

  _renderInto(card, event) {
    const { sanitizeText, colorForTopic, insightArticlesFor } = this.opts;
    const initialsForTopic = this.opts.initialsForTopic || (t => t);
    const slug = event.unique_id;
    const articles = insightArticlesFor(slug) || [];
    const findings = event.related_findings || [];
    const headline = event.text?.headline || '';
    const isTitle = !!event.is_title;
    card.innerHTML = '';
    card.className = 'ait-card' + (event.is_archived ? ' archived' : '') + (isTitle ? ' title' : '');

    card.style.setProperty('--ait-topic-count', event.topics?.length || 0);
    const related = document.createElement('div');
    related.className = 'ait-related';
    related.setAttribute('role', 'group');
    related.setAttribute('aria-label', 'Related content');
    if (!isTitle && event.is_archived) {
      const wrap = document.createElement('div');
      wrap.className = 'archived-ribbon-wrap'; wrap.setAttribute('aria-hidden', 'true');
      const r = document.createElement('div');
      r.className = 'archived-ribbon'; r.textContent = 'ARCHIVED';
      wrap.appendChild(r);
      card.appendChild(wrap);
    }

    // Corner overlays are children of the card (not .ait-body) so they pin to the
    // card edges instead of scrolling with the text.
    if (!isTitle && event.topics?.length) {
      const topics = document.createElement('div');
      topics.className = 'ait-topics';
      [...event.topics].sort().forEach(t => {
        const pill = document.createElement('span');
        pill.className = 'topic-pill';
        pill.textContent = initialsForTopic(t);
        pill.title = t;
        pill.style.backgroundColor = colorForTopic(t);
        topics.appendChild(pill);
      });
      card.appendChild(topics);
    }

    const media = this._buildMedia(event.media);
    if (media) card.appendChild(media);
    const quotes = event.related_quotes || [];
    if (!isTitle && quotes.length) related.appendChild(this._buildQuotePill(card, quotes, slug, headline, fmtDate(event.start_date)));

    const body = document.createElement('div');
    body.className = 'ait-body';

    if (!isTitle && event.purchase_links?.length) {
      const holder = document.createElement('div');
      holder.className = 'ait-cart';
      const btn = document.createElement('button');
      btn.className = 'cart-btn'; btn.type = 'button';
      btn.setAttribute('aria-label', 'Purchase links');
      btn.setAttribute('aria-expanded', 'false');
      btn.dataset.eventId = slug; btn.dataset.eventTitle = headline;
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
      const dd = document.createElement('div');
      dd.className = 'purchase-dropdown';
      event.purchase_links.forEach(l => {
        const a = document.createElement('a');
        a.className = 'purchase-link'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = l.label;
        dd.appendChild(a);
      });
      holder.append(btn, dd);
      card.appendChild(holder);
    }

    const dateText = isTitle ? '' : fmtDate(event.start_date);
    if (dateText) {
      const dl = document.createElement('div');
      dl.className = 'ait-headline-date'; dl.textContent = dateText;
      body.appendChild(dl);
    }

    const h = document.createElement('h2');
    h.className = 'ait-headline'; h.textContent = headline;
    body.appendChild(h);

    const text = document.createElement('div');
    text.className = 'ait-text';
    try { text.innerHTML = sanitizeText(event.text?.text || ''); }
    catch { text.textContent = (event.text?.text || '').replace(/<[^>]*>/g, ''); }
    text.querySelectorAll('a').forEach(a => { a.rel = 'noopener'; });
    body.appendChild(text);

    if (!isTitle && articles.length) {
      const { chips, list } = this._chipGroup('ait-chips', 'insight-ref-chip', 'Insights', articles.length, slug, headline);
      articles.forEach(a => {
        const link = document.createElement('a');
        link.className = 'insight-ref-chip';
        link.href = `/insights/${a.slug}.html`;
        link.dataset.eventId = slug; link.dataset.eventTitle = headline;
        link.dataset.articleSlug = a.slug; link.dataset.articleTitle = a.title;
        link.textContent = a.title;
        link.title = a.title;
        list.appendChild(link);
      });
      related.appendChild(chips);
    }

    if (!isTitle && findings.length) {
      const { chips, list } = this._chipGroup('ait-finding-chips', 'finding-ref-chip', 'Findings', findings.length, slug, headline);
      findings.forEach(f => {
        const link = document.createElement('a');
        link.className = 'finding-ref-chip';
        link.href = `/findings/#${encodeURIComponent(f.slug)}`;
        link.textContent = f.title;
        link.title = f.source ? `${f.title} — ${f.source}` : f.title;
        link.dataset.eventId = slug; link.dataset.eventTitle = headline;
        link.dataset.findingSlug = f.slug; link.dataset.findingTitle = f.title;
        list.appendChild(link);
      });
      related.insertBefore(chips, related.querySelector('.ait-chips'));
    }

    if (related.children.length) card.appendChild(related);
    card.appendChild(body);
    this._buildNav(card);
  }

  _buildQuotePill(card, quotes, slug, headline, dateText = '') {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'ait-quote-pill';
    pill.setAttribute('aria-haspopup', 'dialog');
    pill.setAttribute('aria-expanded', 'false');
    pill.setAttribute('aria-label', quotes.length === 1 ? 'Quote from this entry' : `${quotes.length} quotes from this entry`);
    this._labelRelated(pill, 'Quotes', quotes.length);
    pill.addEventListener('click', () => {
      if (this._quoteOverlay?.isOpen && this._quoteOverlay.opener === pill) { this._quoteOverlay.close(); return; }
      this._quoteOverlay?.destroy();
      const overlay = new MediaOverlay({
        host: card,
        reducedMotion: this.opts.reducedMotion,
        caption: [`On ${headline}`, dateText].filter(Boolean).join(' · ').toUpperCase(),
        items: quotes, label: 'Quotes', className: 'ait-quote-overlay',
        renderItem: (q) => {
          const frag = document.createDocumentFragment();
          const text = document.createElement('blockquote');
          text.className = 'ait-quote-text'; text.dataset.fit = ''; text.textContent = q.text;
          const rule = document.createElement('div');
          rule.className = 'ait-quote-rule'; rule.setAttribute('aria-hidden', 'true');
          const who = document.createElement('p');
          who.className = 'ait-quote-speaker'; who.textContent = q.speaker;
          frag.append(text, rule, who);
          return frag;
        },
        linkFor: (q) => ({ href: `/quotes/#${encodeURIComponent(q.slug)}`, label: 'Read in Quotes →' }),
        onOpen: ({ count }) => {
          pill.setAttribute('aria-expanded', 'true');
          this.opts.onQuoteOpen?.({ eventId: slug, eventTitle: headline, count });
        },
        onNav: ({ index, item }) => this.opts.onQuoteNav?.({ eventId: slug, eventTitle: headline, quoteSlug: item.slug, index }),
        onLinkClick: (q, ev) => this.opts.onQuoteClick?.({ eventId: slug, eventTitle: headline, quoteSlug: q.slug, speaker: q.speaker }, ev),
        onClose: () => pill.setAttribute('aria-expanded', 'false'),
      });
      overlay.opener = pill;
      this._quoteOverlay = overlay;
      overlay.open(pill);
    });
    return pill;
  }

  // Every category opens a list, even for one item, so adjacent controls behave alike.
  _labelRelated(button, label, count) {
    const number = document.createElement('span');
    number.className = 'ait-related-count';
    number.textContent = String(count);
    button.append(document.createTextNode(`${label} `), number);
  }

  _chipGroup(groupClass, chipClass, noun, count, slug, headline) {
    const chips = document.createElement('div');
    chips.className = groupClass;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `${chipClass} chip-toggle`;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.dataset.eventId = slug; toggle.dataset.eventTitle = headline;
    toggle.dataset.noun = noun; toggle.dataset.count = String(count);
    this._labelRelated(toggle, noun, count);
    const list = document.createElement('div');
    list.className = `ait-chip-list ${chipClass}-list`;
    list.hidden = true;
    chips.append(list, toggle);
    return { chips, list };
  }

  _buildMedia(media) {
    if (!media || !media.url) return null;
    const wrap = document.createElement('div');
    wrap.className = 'ait-media';
    const id = ytId(media.url);
    if (id) {
      const f = document.createElement('button');
      f.className = 'ait-yt-facade'; f.type = 'button';
      f.setAttribute('aria-label', 'Play video');
      f.style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/hqdefault.jpg")`;
      f.innerHTML = '<span class="ait-yt-play" aria-hidden="true">▶</span>';
      f.addEventListener('click', () => {
        const ifr = document.createElement('iframe');
        ifr.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
        ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        ifr.allowFullscreen = true;
        ifr.className = 'ait-yt-frame';
        f.replaceWith(ifr);
      });
      wrap.appendChild(f);
    } else if (isImage(media.url)) {
      const img = document.createElement('img');
      // only 2 cards exist at once; load the media straight away (a lazy image
      // can sit unloaded when the centred media column starts below the fold)
      img.decoding = 'async'; img.alt = media.caption || '';
      img.src = media.url;
      img.addEventListener('error', () => { wrap.remove(); });
      wrap.appendChild(img);
    } else {
      const a = document.createElement('a');
      a.className = 'ait-linkcard'; a.href = media.url; a.target = '_blank'; a.rel = 'noopener';
      let host = ''; try { host = new URL(media.url).hostname.replace(/^www\./, ''); } catch {}
      const hostSpan = document.createElement('span');
      hostSpan.className = 'ait-linkcard-host'; hostSpan.textContent = host;
      const titleSpan = document.createElement('span');
      titleSpan.textContent = media.caption || media.url;
      a.append(hostSpan, titleSpan);
      wrap.appendChild(a);
    }
    if (media.caption) {
      const cap = document.createElement('figcaption');
      cap.className = 'ait-media-caption';
      cap.textContent = media.caption;
      wrap.appendChild(cap);
    }
    if (media.credit) {
      const cr = document.createElement('div');
      cr.className = 'ait-media-credit';
      cr.textContent = media.credit;
      wrap.appendChild(cr);
    }
    return wrap;
  }

  _buildNav(card) {
    const nb = this.opts.getNeighbours ? this.opts.getNeighbours() : null;
    if (!nb) return;
    for (const dir of ['prev', 'next']) {
      const info = nb[dir];
      if (!info) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = dir === 'prev' ? 'ait-nav-prev' : 'ait-nav-next';
      btn.dataset.nav = dir;
      btn.setAttribute('aria-label', `${dir === 'prev' ? 'Previous' : 'Next'}: ${info.headline}`);
      const icon = document.createElement('span');
      icon.className = 'ait-nav-icon'; icon.setAttribute('aria-hidden', 'true');
      icon.textContent = dir === 'prev' ? '❮' : '❯';
      const title = document.createElement('span');
      title.className = 'ait-nav-title'; title.textContent = info.headline;
      const date = document.createElement('span');
      date.className = 'ait-nav-date'; date.textContent = info.dateText || '';
      btn.append(icon, title, date);
      card.appendChild(btn);
    }
  }

  _handleClick(ev) {
    const nav = ev.target.closest('.ait-nav-prev, .ait-nav-next');
    if (nav) { this.opts.onNav?.(nav.dataset.nav); return; }
    const cart = ev.target.closest('.cart-btn');
    if (cart) {
      ev.stopPropagation();
      const dd = cart.parentElement.querySelector('.purchase-dropdown');
      const open = dd.classList.contains('open');
      this._closePurchases();
      if (!open) dd.classList.add('open');
      cart.setAttribute('aria-expanded', String(!open));
      this.opts.onCartClick?.(ev);
      return;
    }
    const opt = ev.target.closest('.purchase-link');
    if (opt) { this.opts.onCartOptionClick?.(opt, ev); this._closePurchases(); return; }
    const toggle = ev.target.closest('.chip-toggle');
    if (toggle) {
      const list = toggle.parentElement.querySelector('.ait-chip-list');
      const open = list.hidden;
      this.mount.querySelectorAll('.chip-toggle[aria-expanded="true"]').forEach(other => {
        if (other === toggle) return;
        other.parentElement.querySelector('.ait-chip-list').hidden = true;
        other.setAttribute('aria-expanded', 'false');
      });
      list.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) this.opts.onChipsExpand?.(toggle, ev);
      return;
    }
    const finding = ev.target.closest('.finding-ref-chip');
    if (finding) { this.opts.onFindingClick?.(finding, ev); return; }
    const chip = ev.target.closest('.insight-ref-chip');
    if (chip) { this.opts.onInsightClick?.(chip, ev); return; }
    const link = ev.target.closest('.ait-text a');
    if (link) { this.opts.onTextLinkClick?.(link, ev); return; }
    this._closePurchases();
  }

  _closePurchases() {
    this.mount.querySelectorAll('.purchase-dropdown.open').forEach(d => {
      d.classList.remove('open');
      d.parentElement.querySelector('.cart-btn').setAttribute('aria-expanded', 'false');
    });
  }

  destroy() {
    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    this._gen++; // invalidate any pending transition callback
    this._quoteOverlay?.destroy(); this._quoteOverlay = null;
    this.mount.removeEventListener('click', this._onClick);
    this.mount.removeEventListener('keydown', this._onPillKey);
    this.mount.innerHTML = '';
    this.mount.classList.remove('ait-stage');
    this.mount.removeAttribute('role');
    this.mount.removeAttribute('aria-roledescription');
    this.mount.removeAttribute('aria-label');
    this.mount.removeAttribute('tabindex');
  }
}
