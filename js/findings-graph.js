// Hand-rolled force-directed graph on a 2D canvas. No external libraries.
// Model: { nodes:[{id,type,label,ref}], edges:[{source,target}] } (node ids).
//
// Task 8 scope: canvas scaffold, deterministic seed layout, DPR-aware sizing
// with a ResizeObserver, and a single static _draw(). No physics, no animation
// loop, no pointer interaction — those arrive in Tasks 9 and 10. _kick/_stop/
// setFilter/focus are intentional no-op stubs until then.

const TYPE_STYLE = {
    finding: { r: 6,  fill: '#8b5cf6' },
    topic:   { r: 9,  fill: '#64748b' },   // overridden per-topic by opts.topicColor
    event:   { r: 11, fill: '#f59e0b' },
    insight: { r: 9,  fill: '#ec4899' },
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

        this.nodes = model.nodes.map(n => ({ ...n, ...seed(n.id), vx: 0, vy: 0, fx: null, fy: null }));
        this.index = new Map(this.nodes.map(n => [n.id, n]));
        this.edges = model.edges
            .map(e => ({ a: this.index.get(e.source), b: this.index.get(e.target) }))
            .filter(e => e.a && e.b);
        this.degree = new Map(this.nodes.map(n => [n.id, 0]));
        for (const e of this.edges) {
            this.degree.set(e.a.id, this.degree.get(e.a.id) + 1);
            this.degree.set(e.b.id, this.degree.get(e.b.id) + 1);
        }

        this.alpha = 1;
        this._restLen = new Map(this.edges.map((e, i) => [i,
            (e.a.type === 'topic' || e.b.type === 'topic') ? SIM.lenTopic : SIM.lenOther]));

        this.view = { x: 0, y: 0, k: 1 };     // pan x/y (world units), zoom k
        this.filterSet = null;                 // Set<slug> or null
        this.hoverId = null;
        this._raf = null;
        this._drawScheduled = false;

        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(canvas);
        this._resize();

        this._onVis = () => { if (document.hidden) this._stop(); else this._kick(); };
        document.addEventListener('visibilitychange', this._onVis);

        if (REDUCED) { for (let i = 0; i < 400; i++) this._tick(); this.requestDraw(); }
        else this._kick();
    }

    _resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        if (w <= 0 || h <= 0) return;
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
        this.requestDraw();
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
        return TYPE_STYLE[n.type].fill;
    }

    _nodeRadius(n) {
        const base = TYPE_STYLE[n.type].r;
        return base + Math.min(4, (this.degree.get(n.id) || 0) * 0.5);
    }

    _draw() {
        const ctx = this.ctx;
        if (!this.W || !this.H) return;
        ctx.clearRect(0, 0, this.W, this.H);

        const dim = (id) => this.hoverId && id !== this.hoverId && !this._isNeighbor(id) ? 0.15 : 1;
        const faded = (n) => this.filterSet && n.type === 'finding' && !this.filterSet.has(n.ref) ? 0.15 : 1;

        // edges
        ctx.lineWidth = 1;
        for (const e of this.edges) {
            const alpha = Math.min(dim(e.a.id), dim(e.b.id)) * Math.min(faded(e.a), faded(e.b)) * 0.35;
            ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
            ctx.beginPath();
            ctx.moveTo(this._sx(e.a.x), this._sy(e.a.y));
            ctx.lineTo(this._sx(e.b.x), this._sy(e.b.y));
            ctx.stroke();
        }
        // nodes
        for (const n of this.nodes) {
            const a = dim(n.id) * faded(n);
            ctx.globalAlpha = a;
            ctx.fillStyle = this._nodeFill(n);
            const r = this._nodeRadius(n) * Math.sqrt(this.view.k);
            ctx.beginPath();
            ctx.arc(this._sx(n.x), this._sy(n.y), r, 0, Math.PI * 2);
            ctx.fill();
            const showLabel = n.type !== 'finding' || this.view.k > 1.4 || this.hoverId === n.id;
            if (showLabel && n.label) {
                ctx.globalAlpha = a;
                ctx.fillStyle = '#cbd5e1';
                ctx.font = '11px system-ui, sans-serif';
                ctx.fillText(n.label, this._sx(n.x) + r + 3, this._sy(n.y) + 3);
            }
        }
        ctx.globalAlpha = 1;
    }

    _isNeighbor(id) {
        if (!this.hoverId) return false;
        for (const e of this.edges) {
            if (e.a.id === this.hoverId && e.b.id === id) return true;
            if (e.b.id === this.hoverId && e.a.id === id) return true;
        }
        return false;
    }

    _kick() {
        if (REDUCED || this._raf) return;
        const loop = () => {
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
    _stop() { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; } }

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

    // no-ops until Task 10 (interaction)
    setFilter() {}
    focus() {}

    destroy() {
        this._stop();
        if (this._raf) cancelAnimationFrame(this._raf);
        this._ro.disconnect();
        document.removeEventListener('visibilitychange', this._onVis);
        // Drop any listeners Task 10 attaches directly to the canvas. Guarded so
        // destroy() is safe when the canvas is already detached from the DOM.
        if (this.canvas.parentNode) {
            this.canvas.replaceWith(this.canvas.cloneNode(false));
        }
    }
}
