/**
 * Game of Life Engine
 * Handles the simulation and rendering of the background canvas.
 * Optimized with high-res pre-rendering to eliminate flickering.
 */
export class GameOfLife {
    constructor(canvasId, statsIds) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: true });

        this.off = document.createElement('canvas');
        this.offCtx = this.off.getContext('2d', { alpha: true });

        // Cache canvases for pre-rendering states
        this.fromCanvas = document.createElement('canvas');
        this.fromCtx = this.fromCanvas.getContext('2d', { alpha: true });
        this.toCanvas = document.createElement('canvas');
        this.toCtx = this.toCanvas.getContext('2d', { alpha: true });

        this.stats = {
            gen: document.getElementById(statsIds.gen),
            alive: document.getElementById(statsIds.alive),
            total: document.getElementById(statsIds.total),
            occ: document.getElementById(statsIds.occ)
        };

        this.CELL = 8;
        this.STEP_MS = 1200;
        this.CELL_ALPHA = 0.7;
        this.DIGIT = { '0': [1, 1, 1, 1, 1, 1, 0], '1': [0, 1, 1, 0, 0, 0, 0], '2': [1, 1, 0, 1, 1, 0, 1], '3': [1, 1, 1, 1, 0, 0, 1], '4': [0, 1, 1, 0, 0, 1, 1], '5': [1, 0, 1, 1, 0, 1, 1], '6': [1, 0, 1, 1, 1, 1, 1], '7': [1, 1, 1, 0, 0, 0, 0], '8': [1, 1, 1, 1, 1, 1, 1], '9': [1, 1, 1, 1, 0, 1, 1] };

        this.cols = 0;
        this.rows = 0;
        this.from = null;
        this.to = null;
        this.buffer = null;
        this.generation = 0;
        this.totalCells = 0;
        this.lastStep = 0;
        this.raf = null;

        this.init();
    }

    init() {
        const resize = () => {
            const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
            const w = this.canvas.clientWidth, h = this.canvas.clientHeight;

            // Backup old state for migration
            const oldCols = this.cols;
            const oldRows = this.rows;
            const oldGrid = this.from ? new Uint8Array(this.from) : null;

            // Sync all canvases at high res
            [this.canvas, this.off, this.fromCanvas, this.toCanvas].forEach(c => {
                c.width = Math.floor(w * dpr);
                c.height = Math.floor(h * dpr);
            });

            [this.ctx, this.offCtx, this.fromCtx, this.toCtx].forEach(c => {
                c.setTransform(dpr, 0, 0, dpr, 0, 0);
            });

            this.cols = Math.ceil(w / this.CELL);
            this.rows = Math.ceil(h / this.CELL);
            this.from = new Uint8Array(this.cols * this.rows);
            this.to = new Uint8Array(this.cols * this.rows);
            this.buffer = new Uint8Array(this.cols * this.rows);

            if (oldGrid) {
                // Migrate existing life to the new dimensions
                for (let y = 0; y < Math.min(oldRows, this.rows); y++) {
                    for (let x = 0; x < Math.min(oldCols, this.cols); x++) {
                        this.from[y * this.cols + x] = oldGrid[y * oldCols + x];
                    }
                }
            } else {
                // Initial random seed
                for (let i = 0; i < this.from.length; i++) {
                    this.from[i] = Math.random() < 0.10 ? 1 : 0;
                }
                this.generation = 0;
            }

            this.stepInto(this.from, this.to);

            // Pre-render state to buffers
            this.preRender(this.from, this.fromCtx);
            this.preRender(this.to, this.toCtx);

            this.lastStep = performance.now();
            this.totalCells = this.cols * this.rows;
            this.updateStats(this.countAlive(this.from));
        };

        this.resizeObserver = new ResizeObserver(() => resize());
        this.resizeObserver.observe(this.canvas);
        resize();
        this.loop(performance.now());
        window.addEventListener('beforeunload', () => cancelAnimationFrame(this.raf));
    }

    idx(x, y) { return y * this.cols + x; }

    stepInto(src, dst) {
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                let n = 0;
                for (let j = -1; j <= 1; j++) {
                    for (let i = -1; i <= 1; i++) {
                        if (i || j) {
                            const xx = (x + i + this.cols) % this.cols;
                            const yy = (y + j + this.rows) % this.rows;
                            n += src[this.idx(xx, yy)];
                        }
                    }
                }
                const alive = src[this.idx(x, y)] === 1;
                dst[this.idx(x, y)] = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
            }
        }
    }

    countAlive(arr) {
        let c = 0;
        for (let i = 0; i < arr.length; i++) c += arr[i];
        return c;
    }

    ease(t) {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
    }

    preRender(data, targetCtx) {
        targetCtx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
        targetCtx.fillStyle = '#9fb4e3';
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (data[this.idx(x, y)] === 1) {
                    targetCtx.fillRect(x * this.CELL, y * this.CELL, this.CELL - 1, this.CELL - 1);
                }
            }
        }
    }

    draw(progress) {
        const t = this.ease(progress);
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;

        this.offCtx.clearRect(0, 0, w, h);

        // Blend 'from' and 'to' high-res states
        this.offCtx.globalAlpha = (1 - t) * this.CELL_ALPHA;
        this.offCtx.drawImage(this.fromCanvas, 0, 0, w, h);

        this.offCtx.globalAlpha = t * this.CELL_ALPHA;
        this.offCtx.drawImage(this.toCanvas, 0, 0, w, h);

        this.offCtx.globalAlpha = 1;
        this.ctx.globalCompositeOperation = 'copy';
        this.ctx.drawImage(this.off, 0, 0, w, h);
        this.ctx.globalCompositeOperation = 'source-over';
    }

    loop(now) {
        const progress = (now - this.lastStep) / this.STEP_MS;
        if (progress >= 1) {
            this.from.set(this.to);

            // Swap pre-rendered canvases
            const tmpCanvas = this.fromCanvas;
            const tmpCtx = this.fromCtx;
            this.fromCanvas = this.toCanvas;
            this.fromCtx = this.toCtx;
            this.toCanvas = tmpCanvas;
            this.toCtx = tmpCtx;

            this.stepInto(this.from, this.buffer);
            const aliveNext = this.countAlive(this.buffer);
            this.to.set(this.buffer);

            this.preRender(this.to, this.toCtx);

            this.generation++;
            this.lastStep = now;
            this.updateStats(aliveNext);
        }
        this.draw(Math.min(progress, 1));
        this.raf = requestAnimationFrame((n) => this.loop(n));
    }

    // --- Stats Rendering ---
    createDigit() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 56 110');
        svg.setAttribute('width', '7ch');
        svg.setAttribute('height', '1.7rem');
        const r = 3;
        const rect = (x, y, w, h) => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            el.setAttribute('x', x); el.setAttribute('y', y);
            el.setAttribute('width', w); el.setAttribute('height', h);
            el.setAttribute('rx', r); el.setAttribute('ry', r);
            el.setAttribute('class', 'seg');
            return el;
        };
        const segs = [
            rect(8, 2, 40, 8), rect(48, 10, 8, 40), rect(48, 58, 8, 40),
            rect(8, 98, 40, 8), rect(0, 58, 8, 40), rect(0, 10, 8, 40),
            rect(8, 50, 40, 8)
        ];
        const dp = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dp.setAttribute('cx', '54'); dp.setAttribute('cy', '106'); dp.setAttribute('r', '3');
        dp.setAttribute('class', 'seg');
        svg.append(...segs, dp);
        svg.segs = segs;
        svg.dp = dp;
        return svg;
    }

    setDigit(svg, ch) {
        if (ch === '.') {
            svg.segs.forEach(s => s.setAttribute('class', 'seg'));
            svg.dp.setAttribute('class', 'seg on');
            return;
        }
        const map = this.DIGIT[ch] || [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 7; i++) svg.segs[i].setAttribute('class', map[i] ? 'seg on' : 'seg');
        svg.dp.setAttribute('class', 'seg');
    }

    renderStatsText(container, text) {
        if (!container) return;
        while (container.children.length < text.length) container.appendChild(this.createDigit());
        while (container.children.length > text.length) container.removeChild(container.lastChild);
        for (let i = 0; i < text.length; i++) this.setDigit(container.children[i], text[i]);
    }

    updateStats(alive) {
        const pad8 = n => Math.floor(Math.max(0, n)).toString().padStart(8, '0');
        const occFmt = (a, t) => {
            const pct = t > 0 ? (a / t * 100) : 0;
            const c = Math.min(100, Math.max(0, pct));
            const [i, d] = c.toFixed(3).split('.');
            return i.padStart(3, '0') + '.' + d;
        };
        this.renderStatsText(this.stats.gen, pad8(this.generation));
        this.renderStatsText(this.stats.alive, pad8(alive));
        this.renderStatsText(this.stats.total, pad8(this.totalCells));
        this.renderStatsText(this.stats.occ, occFmt(alive, this.totalCells));
    }
}
