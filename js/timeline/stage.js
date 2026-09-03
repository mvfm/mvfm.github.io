const YT_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/;

function ytId(url) { const m = url && url.match(YT_RE); return m ? m[1] : null; }
function isImage(url) { return /\.(jpe?g|png|gif|webp|svg|avif)(\?|$)/i.test(url || ''); }

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
    // one delegated click handler for all overlay interactions
    this._onClick = (ev) => this._handleClick(ev);
    this.mount.addEventListener('click', this._onClick);
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
    const incoming = this._cards[1 - this._front];
    const outgoing = this._cards[this._front];
    this._renderInto(incoming, event);

    const reduce = this.opts.reducedMotion || direction === 'initial' || direction === 'jump';
    // never more than 2 nodes: we only ever toggle `hidden` + transition classes
    outgoing.classList.remove('ait-enter', 'ait-enter-prev');
    incoming.hidden = false;
    if (reduce) {
      outgoing.hidden = true;
    } else {
      incoming.classList.add(direction === 'prev' ? 'ait-enter-prev' : 'ait-enter');
      // force reflow then clear to animate
      void incoming.offsetWidth;
      incoming.classList.remove('ait-enter', 'ait-enter-prev');
      outgoing.classList.add(direction === 'prev' ? 'ait-leave-prev' : 'ait-leave');
      const done = () => { outgoing.hidden = true; outgoing.classList.remove('ait-leave', 'ait-leave-prev'); outgoing.removeEventListener('transitionend', done); };
      outgoing.addEventListener('transitionend', done);
      // safety: if no transitionend (interrupted), hide on next frame batch
      setTimeout(done, 400);
    }
    this._front = 1 - this._front;
    this._live.textContent = event.text?.headline || '';
    this.mount.setAttribute('aria-label', `${event.text?.headline || 'Entry'}`);
  }

  _renderInto(card, event) {
    const { sanitizeText, colorForTopic, insightArticlesFor } = this.opts;
    const slug = event.unique_id;
    const articles = insightArticlesFor(slug) || [];
    const headline = event.text?.headline || '';
    card.innerHTML = '';

    if (articles.length) {
      const stripe = document.createElement('div');
      stripe.className = 'insight-ref-stripe';
      card.appendChild(stripe);
    }
    if (event.is_archived) {
      const r = document.createElement('div');
      r.className = 'archived-ribbon'; r.setAttribute('aria-hidden', 'true'); r.textContent = 'ARCHIVED';
      card.appendChild(r);
    }

    const media = this._buildMedia(event.media);
    if (media) card.appendChild(media);

    const body = document.createElement('div');
    body.className = 'ait-body';

    if (event.topics?.length) {
      const wrap = document.createElement('div');
      wrap.className = 'ait-topics';
      [...event.topics].sort().forEach(t => {
        const pill = document.createElement('span');
        pill.className = 'topic-pill';
        pill.textContent = t;
        pill.title = t;
        pill.style.backgroundColor = colorForTopic(t);
        wrap.appendChild(pill);
      });
      body.appendChild(wrap);
    }

    if (event.purchase_links?.length) {
      const holder = document.createElement('div');
      holder.className = 'ait-cart';
      const btn = document.createElement('button');
      btn.className = 'cart-btn'; btn.type = 'button';
      btn.setAttribute('aria-label', 'Purchase links');
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
      body.appendChild(holder);
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

    if (articles.length) {
      const chips = document.createElement('div');
      chips.className = 'ait-chips';
      articles.forEach(a => {
        const link = document.createElement('a');
        link.className = 'insight-ref-chip';
        link.href = `/insights/${a.slug}.html`;
        link.dataset.eventId = slug; link.dataset.eventTitle = headline;
        link.dataset.articleSlug = a.slug; link.dataset.articleTitle = a.title;
        link.textContent = `✦ ${a.title}`;
        chips.appendChild(link);
      });
      body.appendChild(chips);
    }

    card.appendChild(body);
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
      img.loading = 'lazy'; img.decoding = 'async'; img.alt = media.caption || '';
      img.src = media.url;
      img.addEventListener('error', () => { wrap.remove(); });
      wrap.appendChild(img);
    } else {
      const a = document.createElement('a');
      a.className = 'ait-linkcard'; a.href = media.url; a.target = '_blank'; a.rel = 'noopener';
      let host = ''; try { host = new URL(media.url).hostname.replace(/^www\./, ''); } catch {}
      a.innerHTML = `<span class="ait-linkcard-host">${host}</span><span class="ait-linkcard-title">${media.caption || media.url}</span>`;
      wrap.appendChild(a);
    }
    if (media.caption || media.credit) {
      const cap = document.createElement('figcaption');
      cap.className = 'ait-media-caption';
      cap.textContent = [media.caption, media.credit].filter(Boolean).join(' — ');
      wrap.appendChild(cap);
    }
    return wrap;
  }

  _handleClick(ev) {
    const cart = ev.target.closest('.cart-btn');
    if (cart) {
      ev.stopPropagation();
      const dd = cart.parentElement.querySelector('.purchase-dropdown');
      const open = dd.classList.contains('open');
      this.mount.querySelectorAll('.purchase-dropdown.open').forEach(d => d.classList.remove('open'));
      if (!open) dd.classList.add('open');
      this.opts.onCartClick?.(ev);
      return;
    }
    const opt = ev.target.closest('.purchase-link');
    if (opt) { this.opts.onCartOptionClick?.(opt, ev); this.mount.querySelectorAll('.purchase-dropdown.open').forEach(d => d.classList.remove('open')); return; }
    const chip = ev.target.closest('.insight-ref-chip');
    if (chip) { this.opts.onInsightClick?.(chip, ev); return; }
    const link = ev.target.closest('.ait-text a');
    if (link) { this.opts.onTextLinkClick?.(link, ev); return; }
    this.mount.querySelectorAll('.purchase-dropdown.open').forEach(d => d.classList.remove('open'));
  }

  destroy() {
    this.mount.removeEventListener('click', this._onClick);
    this.mount.innerHTML = '';
    this.mount.classList.remove('ait-stage');
    this.mount.removeAttribute('role');
    this.mount.removeAttribute('aria-roledescription');
    this.mount.removeAttribute('aria-label');
    this.mount.removeAttribute('tabindex');
  }
}
