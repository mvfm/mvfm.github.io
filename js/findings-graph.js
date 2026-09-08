// Hand-rolled force-directed graph on a 2D canvas. No external libraries.
// Model: { nodes:[{id,type,label,ref}], edges:[{source,target}] } (node ids).
//
// Full engine: canvas scaffold + deterministic seed layout + DPR-aware sizing
// (ResizeObserver), a self-halting rAF force simulation (repulsion / springs /
// centering, alpha-cooled), and pointer interaction — hover highlight, node
// drag (pins via fx/fy), empty-space pan, wheel zoom-to-cursor, click →
// opts callbacks, and minimal one-finger touch pan. Public control surface:
// setFilter({ matchedFindingSlugs }), focusFinding(slug), zoomBy(f), resetView().

const TYPE_STYLE = {
    finding: { r: 9, fill: '#0d9488' },
    topic:   { r: 11, fill: '#64748b' },   // overridden per-topic by opts.topicColor
    event:   { r: 5, fill: '#d97706' },
    insight: { r: 7, fill: '#9333ea' },
};

// Light-theme defaults (the site is light-only). opts.palette overrides per key.
const PALETTE = {
    label: '#334155',                  // dark slate — readable on the white page
    edge:  'rgba(100,116,139,0.55)',   // mid grey with enough alpha to read on white
};

const SIM = {
    repulsion: 2600,
    spring: 0.02,
    lenTopic: 70,
    lenOther: 130,
    center: 0.008,
    damping: 0.85,
    minAlpha: 0.02,
};
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 2 ** 32;
}

// Deterministic seed position from a node id — same id always lands in the same
// spot, so the layout is stable across reloads before the sim runs.
function seed(id) {
    return { x: (hash(id) - 0.5) * 600, y: (hash(id + '#y') - 0.5) * 600 };
}

export class FindingsGraph {
    constructor(canvas, model, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.opts = opts;
        this.P = { ...PALETTE, ...(opts.palette || {}) };

        this.nodes = model.nodes.map(n => ({ ...n, ...seed(n.id), vx: 0, vy: 0, fx: null, fy: null }));
        this.index = new Map(this.nodes.map(n => [n.id, n]));
        this.edges = model.edges
            .map(e => ({ a: this.index.get(e.source), b: this.index.get(e.target) }))
            .filter(e => e.a && e.b);
        this.degree = new Map(this.nodes.map(n => [n.id, 0]));
        this.neighbours = new Map(this.nodes.map(n => [n.id, new Set()]));
        for (const e of this.edges) {
            this.neighbours.get(e.a.id).add(e.b.id);
            this.neighbours.get(e.b.id).add(e.a.id);
            this.degree.set(e.a.id, this.degree.get(e.a.id) + 1);
            this.degree.set(e.b.id, this.degree.get(e.b.id) + 1);
        }

        this.alpha = 1;
        this._restLen = new Map(this.edges.map((e, i) => [i,
            (e.a.type === 'topic' || e.b.type === 'topic') ? SIM.lenTopic : SIM.lenOther]));

        this.view = { x: 0, y: 0, k: 1 };     // pan x/y (world units), zoom k
        this._autoFit = true;
        this.selectedId = null;
        this._followId = null;
        this.filterSet = null;                 // Set<slug> or null
        this.visibleNonFinding = null;         // Set<nodeId> of non-finding nodes still tied to a visible finding
        this.hoverId = null;
        this._raf = null;
        this._drawScheduled = false;
        this._cameraFrame = null;
        this._cameraTarget = null;
        this._visible = false;

        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(canvas);
        this._resize();
        this._bindPointer();

        this._onVis = () => { if (document.hidden) this._stop(); else this._kick(); };
        document.addEventListener('visibilitychange', this._onVis);

        if (REDUCED) { for (let i = 0; i < 400; i++) this._tick(); this.requestDraw(); }
        else this._kick();
    }

    _resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        if (w <= 0 || h <= 0) { this._visible = false; this._stop(); return; }
        const opening = !this._visible;
        this._visible = true;
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
        if (this._autoFit) this._fit();
        this.requestDraw();
        // Let the simulation play in view, instead of settling behind the List.
        if (opening) this.alpha = Math.max(this.alpha, .4);
        this._kick();
    }

    // world → screen
    _sx(x) { return (x - this.view.x) * this.view.k + this.W / 2; }
    _sy(y) { return (y - this.view.y) * this.view.k + this.H / 2; }

    requestDraw() {
        if (this._drawScheduled) return;
        this._drawScheduled = true;
        requestAnimationFrame(() => { this._drawScheduled = false; this._draw(); });
    }

    _nodeFill(n) {
        if (n.type === 'topic' && this.opts.topicColor) {
            const c = this.opts.topicColor(n.ref);
            if (c) return c;
        }
        return this.P[n.type] || TYPE_STYLE[n.type].fill;
    }

    _nodeRadius(n) {
        const base = TYPE_STYLE[n.type].r;
        return base + Math.min(3, (this.degree.get(n.id) || 0) * 0.3);
    }

    _draw() {
        const ctx = this.ctx;
        if (!this.W || !this.H) return;
        if (this._autoFit && !this._cameraTarget) this._fit();
        // The simulation keeps moving nodes after the opening camera transition.
        const followed = this.index.get(this._followId);
        if (followed) {
            const target = this._cameraTarget || this.view;
            target.x = followed.x;
            target.y = followed.y;
        }
        ctx.clearRect(0, 0, this.W, this.H);

        const dim = (id) => this.hoverId && id !== this.hoverId && !this._isNeighbor(id) ? 0.15 : 1;
        // Spec §5: with a filter active, fade non-matching finding nodes AND any
        // topic/event/insight node left with no visible finding.
        const faded = (n) => {
            if (!this.filterSet) return 1;
            if (n.type === 'finding') return this.filterSet.has(n.ref) ? 1 : 0.15;
            return (this.visibleNonFinding && this.visibleNonFinding.has(n.id)) ? 1 : 0.15;
        };

        // edges
        for (const e of this.edges) {
            const active = e.a.id === this.hoverId || e.b.id === this.hoverId;
            ctx.lineWidth = active ? 1.7 : .8;
            ctx.strokeStyle = active ? this._nodeFill(this.index.get(this.hoverId)) : this.P.edge;
            ctx.globalAlpha = (active ? .85 : .3) * Math.min(dim(e.a.id), dim(e.b.id)) * Math.min(faded(e.a), faded(e.b));
            ctx.beginPath();
            ctx.moveTo(this._sx(e.a.x), this._sy(e.a.y));
            ctx.lineTo(this._sx(e.b.x), this._sy(e.b.y));
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // nodes
        for (const n of this.nodes) {
            const a = n.id === this.selectedId ? 1 : dim(n.id) * faded(n);
            ctx.globalAlpha = a;
            const color = this._nodeFill(n);
            ctx.fillStyle = n.type === 'topic' ? '#fff' : color;
            const r = this._nodeRadius(n) * Math.sqrt(Math.max(.65, this.view.k));
            const x = this._sx(n.x), y = this._sy(n.y);
            if (n.id === this.hoverId || n.id === this.selectedId) {
                ctx.globalAlpha = .12;
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = a; ctx.fillStyle = n.type === 'topic' ? '#fff' : color;
            }
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = n.type === 'topic' ? color : '#fff';
            ctx.lineWidth = n.type === 'topic' ? 2.5 : 1.8; ctx.stroke();
        }
        // Place important labels first and skip collisions rather than printing
        // every title over its neighbours. Hover always reveals a full title.
        const rank = n => n.id === this.selectedId ? -2 : n.id === this.hoverId ? -1 : ({ topic: 0, finding: 1, insight: 2, event: 3 }[n.type]);
        const occupied = [];
        for (const n of [...this.nodes].sort((a, b) => rank(a) - rank(b))) {
            const active = n.id === this.hoverId || n.id === this.selectedId;
            if (!n.label || (!active && faded(n) < 1) || (this.hoverId && !active && !this._isNeighbor(n.id))) continue;
            if (n.type === 'event' && !active && !this.hoverId && this.view.k < 1.2) continue;
            ctx.font = `${n.type === 'topic' || active ? 600 : 500} 11px system-ui, sans-serif`;
            let label = n.label;
            const limit = active ? Math.min(340, this.W - 40) : (this.W < 500 ? 116 : 168);
            while (ctx.measureText(label).width > limit && label.length > 1) label = label.slice(0, -1);
            if (label !== n.label) label = label.slice(0, -1).trimEnd() + '…';
            const width = ctx.measureText(label).width + 12;
            const x = Math.max(8, Math.min(this.W - width - 8, this._sx(n.x) + this._nodeRadius(n) + 5));
            const y = this._sy(n.y) - 11;
            if (y < 64 || y + 22 > this.H - 90) continue;
            const box = { x, y, w: width, h: 22 };
            if (!active && occupied.some(b => x < b.x + b.w + 3 && x + width + 3 > b.x && y < b.y + b.h + 3 && y + 25 > b.y)) continue;
            occupied.push(box);
            ctx.globalAlpha = active ? 1 : .94;
            ctx.fillStyle = active ? '#e2e8f0' : '#ffffff';
            ctx.beginPath(); ctx.roundRect(x, y, width, 22, 6); ctx.fill();
            ctx.fillStyle = this.P.label; ctx.fillText(label, x + 6, y + 15);
        }
        ctx.globalAlpha = 1;
    }

    _isNeighbor(id) {
        if (!this.hoverId) return false;
        return this.neighbours.get(this.hoverId)?.has(id) || false;
    }

    _kick() {
        if (REDUCED || this._raf || !this._visible || document.hidden) return;
        const loop = () => {
            if (!document.body.contains(this.canvas)) { this.destroy(); return; }
            this._tick();
            this._draw();
            if (this.alpha > SIM.minAlpha || this._dragging) {
                this._raf = requestAnimationFrame(loop);
            } else {
                this._raf = null;
            }
        };
        this._raf = requestAnimationFrame(loop);
    }
    _stop() {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        this._cancelCamera();
    }

    _cancelCamera() {
        if (this._cameraFrame) cancelAnimationFrame(this._cameraFrame);
        this._cameraFrame = null;
        this._cameraTarget = null;
    }

    _animateView(target) {
        this._cancelCamera();
        if (REDUCED || !this._visible) { this.view = target; this.requestDraw(); return; }
        const start = { ...this.view }, began = performance.now();
        this._cameraTarget = target;
        const step = now => {
            const t = Math.min(1, (now - began) / 260);
            const ease = 1 - (1 - t) ** 3;
            this.view = { x: start.x + (target.x - start.x) * ease,
                y: start.y + (target.y - start.y) * ease, k: start.k + (target.k - start.k) * ease };
            this.requestDraw();
            if (t < 1) this._cameraFrame = requestAnimationFrame(step);
            else { this._cameraFrame = null; this._cameraTarget = null; }
        };
        this._cameraFrame = requestAnimationFrame(step);
    }

    _reheat(a = 0.4) { this.alpha = Math.max(this.alpha, a); this._kick(); }

    _tick() {
        const ns = this.nodes;
        // repulsion (O(n^2), fine < ~800 nodes)
        for (let i = 0; i < ns.length; i++) {
            const p = ns[i];
            for (let j = i + 1; j < ns.length; j++) {
                const q = ns[j];
                let dx = p.x - q.x, dy = p.y - q.y;
                let d2 = dx * dx + dy * dy || 0.01;
                const f = (SIM.repulsion * this.alpha) / d2;
                const d = Math.sqrt(d2);
                const fx = (dx / d) * f, fy = (dy / d) * f;
                p.vx += fx; p.vy += fy; q.vx -= fx; q.vy -= fy;
            }
        }
        // springs
        this.edges.forEach((e, i) => {
            const L = this._restLen.get(i);
            let dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const f = SIM.spring * (d - L) * this.alpha;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
        });
        // centering + integrate
        for (const n of ns) {
            n.vx -= n.x * SIM.center * this.alpha;
            n.vy -= n.y * SIM.center * this.alpha;
            if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
            n.vx *= SIM.damping; n.vy *= SIM.damping;
            n.x += n.vx; n.y += n.vy;
        }
        this.alpha *= 0.985;
    }

    // screen (canvas px) → nearest node within its on-screen radius, else null
    _pick(px, py) {
        let best = null, bestD = Infinity;
        for (const n of this.nodes) {
            const dx = px - this._sx(n.x), dy = py - this._sy(n.y);
            const d = Math.hypot(dx, dy);
            const r = Math.max(12, this._nodeRadius(n) * Math.sqrt(Math.max(.65, this.view.k)) + 4);
            if (d < r && d < bestD) { best = n; bestD = d; }
        }
        return best;
    }

    _bindPointer() {
        const c = this.canvas;
        let dragNode = null, panning = false, last = null, moved = false;

        c.addEventListener('mousemove', (e) => {
            const rect = c.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            if (dragNode) {
                const k = this.view.k;
                dragNode.fx = (px - this.W / 2) / k + this.view.x;
                dragNode.fy = (py - this.H / 2) / k + this.view.y;
                moved = true;
                this._reheat(0.3);
                if (REDUCED) { this._tick(); this.requestDraw(); }
                return;
            }
            if (panning) {
                moved = true;
                this.view.x -= (px - last.x) / this.view.k;
                this.view.y -= (py - last.y) / this.view.k;
                last = { x: px, y: py };
                this.requestDraw();
                return;
            }
            const hit = this._pick(px, py);
            c.title = hit ? `${hit.label} · ${this.degree.get(hit.id)} connections` : '';
            const id = hit ? hit.id : null;
            if (id !== this.hoverId) { this.hoverId = id; c.style.cursor = hit ? 'pointer' : 'default'; this.requestDraw(); }
        });

        c.addEventListener('mouseleave', () => { this.hoverId = null; c.title = ''; this.requestDraw(); });

        c.addEventListener('mousedown', (e) => {
            this._cancelCamera();
            this._autoFit = false;
            this._followId = null;
            const rect = c.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            const hit = this._pick(px, py);
            moved = false;
            if (hit) { dragNode = hit; hit.fx = hit.x; hit.fy = hit.y; }
            else { panning = true; last = { x: px, y: py }; }
        });

        // window-level so a release outside the canvas still ends the gesture;
        // stored on `this` so destroy() can remove it (the canvas-clone trick
        // in destroy() only drops listeners bound to the canvas itself).
        this._onUp = () => {
            if (dragNode) { dragNode.fx = null; dragNode.fy = null; dragNode = null; }
            panning = false;
        };
        window.addEventListener('mouseup', this._onUp);

        c.addEventListener('click', (e) => {
            if (moved) return;   // suppress the click that follows a drag/pan
            const rect = c.getBoundingClientRect();
            const hit = this._pick(e.clientX - rect.left, e.clientY - rect.top);
            if (!hit) return;
            const { onSelectFinding, onSelectTopic, onNavigate } = this.opts;
            if (hit.type === 'finding') onSelectFinding && onSelectFinding(hit.ref);
            else if (hit.type === 'topic') onSelectTopic && onSelectTopic(hit.ref);
            else onNavigate && onNavigate(hit.type, hit.ref);
        });

        c.addEventListener('wheel', (e) => {
            this._autoFit = false;
            this._followId = null;
            e.preventDefault();
            const rect = c.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            const base = this._cameraTarget || this.view;
            const wx = (px - this.W / 2) / base.k + base.x;
            const wy = (py - this.H / 2) / base.k + base.y;
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const k = Math.max(0.1, Math.min(4, base.k * factor));
            this._animateView({ k, x: wx - (px - this.W / 2) / k, y: wy - (py - this.H / 2) / k });
        }, { passive: false });

        // minimal touch: one finger = pan, tap falls through to synthetic click
        let t0 = null;
        c.addEventListener('touchstart', (e) => { moved = false; if (e.touches.length === 1) t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
        c.addEventListener('touchmove', (e) => {
            this._cancelCamera();
            this._autoFit = false;
            this._followId = null;
            if (e.touches.length !== 1 || !t0) return;
            moved = true;
            const t = e.touches[0];
            this.view.x -= (t.clientX - t0.x) / this.view.k;
            this.view.y -= (t.clientY - t0.y) / this.view.k;
            t0 = { x: t.clientX, y: t.clientY };
            this.requestDraw();
        }, { passive: true });
    }

    // Update optional labels without disturbing the settled layout or selection.
    setLabels(labels) {
        for (const node of this.nodes) {
            if (labels.has(node.id)) node.label = labels.get(node.id);
        }
        this.requestDraw();
    }

    setFilter({ matchedFindingSlugs = null } = {}) {
        this.filterSet = matchedFindingSlugs;
        if (matchedFindingSlugs) {
            // Any non-finding node that still connects to a matched finding stays lit.
            const keep = new Set();
            for (const e of this.edges) {
                const f = e.a.type === 'finding' ? e.a : (e.b.type === 'finding' ? e.b : null);
                const other = e.a === f ? e.b : e.a;
                if (f && other.type !== 'finding' && matchedFindingSlugs.has(f.ref)) keep.add(other.id);
            }
            this.visibleNonFinding = keep;
        } else {
            this.visibleNonFinding = null;
        }
        this.requestDraw();   // filter fade is a redraw, not a re-solve
    }

    // Force a backing-store re-measure (e.g. after display:none → visible on mobile).
    resize() { this._resize(); }

    // Called after revealing Map so the camera uses its current viewport.
    focusFinding(slug) {
        const node = this.index.get(`finding:${slug}`);
        if (!node) return;
        this.selectedId = node.id;
        this._resize();
        this._autoFit = false;
        this._followId = null;
        this._animateView({ x: node.x, y: node.y, k: Math.max(this.view.k, 1.2) });
        this._followId = node.id;
        this.requestDraw();
    }

    _fit() {
        if (!this.W || !this.H || !this.nodes.length) return;
        const xs = this.nodes.map(n => n.x), ys = this.nodes.map(n => n.y);
        const loX = Math.min(...xs), hiX = Math.max(...xs), loY = Math.min(...ys), hiY = Math.max(...ys);
        this.view = { x: (loX + hiX) / 2, y: (loY + hiY) / 2 - 10,
            k: Math.max(.1, Math.min(1.35, (this.W - 90) / Math.max(1, hiX - loX), (this.H - 200) / Math.max(1, hiY - loY))) };
    }
    zoomBy(f) {
        this._autoFit = false;
        this._followId = null;
        const base = this._cameraTarget || this.view;
        this._animateView({ ...base, k: Math.max(.1, Math.min(4, base.k * f)) });
    }
    resetView() {
        this.selectedId = null;
        this._followId = null;
        this._autoFit = true;
        const start = { ...this.view };
        this._fit();
        const target = this.view;
        this.view = start;
        this._animateView(target);
    }

    destroy() {
        this._stop();
        this._ro.disconnect();
        document.removeEventListener('visibilitychange', this._onVis);
        if (this._onUp) window.removeEventListener('mouseup', this._onUp);
        // Drop the listeners bound directly to the canvas. Guarded so destroy()
        // is safe when the canvas is already detached from the DOM.
        if (this.canvas.parentNode) {
            this.canvas.replaceWith(this.canvas.cloneNode(false));
        }
    }
}
