# mvfm.github.io

Personal website for [Marcus Vinicius Freitas Margarites](https://mvfm.digital) — Systems Engineer & AI Researcher.

Live at **https://mvfm.digital** · hosted on GitHub Pages (custom domain via `CNAME`).

---

## 1. What it does

A single-page personal site that doubles as a small research publication around the
history of Artificial Intelligence. Six routes:

| Route | Purpose |
|---|---|
| `home` | Landing copy and links into the AI content. |
| `contact` | Email + LinkedIn. |
| `resume` | Résumé summary, PDF link, and a decorative "quip" pulled from the backend. |
| `ai` | **AI History Timeline** — a bespoke, virtualized, searchable/filterable timeline of curated AI-history events fetched from a backend API. |
| `insights` | Card listing of long-form essays. Each essay is also a standalone, crawlable static HTML page. |
| `findings` | A curated link library plus a hand-rolled force-directed graph connecting findings ⇄ topics ⇄ timeline events ⇄ insights. |

Cross-cutting features:

- A Conway's Game of Life canvas animation behind every page, with a live
  7-segment-style stats readout.
- First-party analytics (page views + rich interaction events) batched to a
  backend beacon endpoint.
- A separate, token-gated analytics **dashboard** (`dashboard.html`) rendering
  seven sections of charts.
- SEO / crawler support: server-served `.html` twins for every route, `<noscript>`
  fallbacks, JSON-LD structured data, `sitemap.xml`, `robots.txt`.

---

## 2. How it does it

### 2.1 Runtime shape

**Pure vanilla HTML/CSS/JS. No framework, no bundler, no build step.** ES6 modules
are loaded directly by the browser from `/js/`. GitHub Pages serves the files
as-is.

```
Browser
 ├── index.html / ai.html / insights/*.html / findings/index.html   (SPA shells)
 │     └── <script type="module" src="/js/main.js">
 │           ├── shell.js      inject brand + nav + shared <template>s (SSOT)
 │           ├── ui.js         sticky/shrinking header, --topbar-height
 │           ├── gol.js        Game of Life background
 │           ├── router.js     History API router + per-route lifecycle
 │           ├── analytics.js  event batching + Beacon flush
 │           ├── config.js     backend base URL (single source of truth)
 │           ├── topics.js     topic → colour + topic → acronym
 │           ├── timeline/*    bespoke AI timeline component
 │           └── findings*.js  findings list + graph
 └── FastAPI backend (PythonAnywhere)  →  /api/v2/*
```

### 2.2 The SPA shell + single source of truth

Every HTML entry point (`index.html`, `ai.html`, each `insights/<slug>.html`,
`findings/index.html`) ships the **same empty skeleton**: an empty `.brand`, an
empty `.menu`, and no tab templates. On `DOMContentLoaded`, `js/shell.js`
`injectShell()` fills in:

- the brand text and the six nav buttons (`NAV_ITEMS`);
- one `<template id="tpl-…">` per common tab (Home, Contact, Résumé, AI, Insights,
  Findings).

`js/shell.js` is therefore the **only** place brand/nav/common-template markup
lives. An article page adds exactly one page-specific `<template id="tpl-feature">`
and sets `window.__FEATURE_SLUG__` before `main.js` runs.

### 2.3 Routing (`js/router.js`)

- History API (`pushState` / `popstate`), no hash routing for navigation.
- `navigate()` swaps the active template into `#contentPanel` by cloning
  `template.content`, runs an exit/enter CSS transition, updates `<title>` +
  `<meta>` + canonical link, and fires a `page_view` analytics event
  (**only** the router fires `page_view`).
- Route definitions carry `onLoad` / `onUnload` hooks. `onUnload` runs before the
  outgoing DOM is wiped so a route can tear down listeners/observers.
- Root path (`/`) restores the last route from `localStorage.lastRoute`.
- `window.__FEATURE_SLUG__` activates the non-persisted `insights-article` route,
  which renders `tpl-feature` directly.

### 2.4 AI Timeline component (`js/timeline/`)

Bespoke and virtualized; replaced KnightLab TimelineJS in **September 2026**
(design doc: `docs/superpowers/specs/2026-09-03-bespoke-timeline-design.md`).
The `/ai` route loads **no CDN**.

| Module | Responsibility | Purity |
|---|---|---|
| `scale.js` | Date-sorted events → warped axis positions in `[0,1]`; gap widths `lerp(realGap, equalGap, ALPHA=0.6)`. No hard-coded dates. | Pure, unit-tested |
| `minimap.js` | One `<canvas>`: three group lanes, era bands, draggable/resizable focus window, playhead, adaptive year/month/day ticks, wheel/pinch/drag zoom. | DOM/canvas |
| `stage.js` | Renders exactly one event card (image / YouTube facade / link media; sanitized `b/i/p/a/br` text; topic pills; insight chip + stripe; purchase cart; archived ribbon). Never > 2 card nodes in the DOM. | DOM |
| `timeline.js` | `AITimeline` orchestrator. Public API: `setEvents`, `goToId`, `goToIndex`, `first`, `last`, `getCurrentSlide`, `on('change')`, `destroy()`. | DOM |

`AITimeline` receives **all** its collaborators through an `opts` object
(`colorForTopic`, `initialsForTopic`, `insightArticlesFor`, `sanitizeText`,
`track`, `slugify`, `reducedMotion`, click callbacks). It imports nothing from
`main.js`.

Fetch: 3 attempts, 2 s delay, 60 s `AbortController` timeout, against
`GET /api/v2/timeline` with optional `?q=`, `?topics=`, `?slugs=`. On success it
injects a JSON-LD `ItemList` into `<head>`.

### 2.5 Insights (`insights/`)

Static HTML pages exist so Google can index the essays. Each page:

- reuses the SPA shell (brand/nav/common templates injected at runtime);
- defines one `<template id="tpl-feature">` with the article body;
- sets `window.__FEATURE_SLUG__`;
- fires `insights_entry_view { slug }` on load.

`insights/manifest.json` (`{slug, title, description, date, topics[],
referenced_events[]}`) is the data source for the JS-rendered card grid on the
`/insights` tab, and its `referenced_events` drive the purple "referenced by an
article" stripe/chip on matching timeline entries.

### 2.6 Findings (`findings/`)

- `GET /api/v2/findings` — complete newest-first collection in
  `{findings, topics, total}`. Each finding has `{id, slug, title, url, source,
  date_added, updated_at, note, topics[], referenced_events[], referenced_insights[]}`.
  Event references are `{id, slug, title}` objects; Insight references remain slug
  strings. Top-level topics are the shared global vocabulary, also returned by
  `/timeline`. Timeline slugs remain derived from headlines exactly as before.
- `js/findings-api.js` — validates the response contract, bounds requests with a
  timeout, supports cancellation, and resolves `/api/v2/findings/{slug}` details.
- `js/findings-model.js` — **pure**, unit-tested: `deriveEventLabel`,
  `buildGraphModel`, `filterFindings`.
- `js/findings-graph.js` — `FindingsGraph`: a hand-rolled Canvas 2D force
  simulation (repulsion / springs / centering, alpha-cooled, self-halting rAF).
  **Imports nothing from app code** — palette, `topicColor`, and callbacks arrive
  via `opts`. Honors `prefers-reduced-motion`, pauses on tab hide, self-disposes
  when its canvas leaves the DOM.
- `js/findings.js` — loads the API collection, renders list + filters + detail
  panel, and instantiates the graph. Insights manifest titles load as optional
  enrichment after rendering. No topic-only timeline request is needed.
  `/findings#slug` opens a detail, with the detail endpoint as fallback for slugs
  absent from the collection. Hash changes update the panel; `onUnload` cancels
  requests, timers, route listeners, and the graph. API errors show Retry and are
  distinguished from an empty collection.
- Timeline events may carry `related_findings: [{id, slug, title, source}]`.
  The stage renders these as teal pills below the media on the left, with the original purple Insights pills on the right and emits
  `timeline_finding_click {event_id, event_title, finding_slug, finding_title}`.
  Missing backlinks are treated as an empty array for backend rollout compatibility.
- `findings/manifest.json` is retained as migration/rollback source only; the
  frontend no longer fetches it. New findings are authored in AIAPI and published
  through its content workflow. `findings/index.html` remains the reusable shell;
  its noscript list is a separately maintained static snapshot, not live API data.

Deploy the backend endpoints, migrate the manifest, and publish the records before
releasing this frontend switch. No frontend HTML or JSON edits are required to
add live Findings records. API errors do not silently fall back to stale JSON.

### 2.7 Game of Life (`js/gol.js`)

Background `<canvas>`. Four off-screen canvases double-buffer the "from" and "to"
generations at full `devicePixelRatio`, blended with an easing function across the
1.2 s step — flicker-free. Stats (generation, alive, total, occupancy %) render as
programmatically-built SVG 7-segment digits. Simulation pauses on
`visibilitychange`.

### 2.8 Analytics (`js/analytics.js`)

- `track(event, props)` pushes onto an in-memory queue.
- Flush every 5 s; immediate flush at `MAX_PENDING = 50`.
- On `visibilitychange → hidden` and `pagehide`: `navigator.sendBeacon`
  (keepalive `fetch` fallback).
- Failed sends: 4xx dropped permanently; 5xx / network errors go to a bounded
  retry queue (`MAX_RETRY_BATCHES = 10`, `MAX_RETRY_ATTEMPTS = 5`).
- Session id: `crypto.randomUUID()` in `sessionStorage`.
- Test seams exported: `_reset`, `_getPendingQueue`, `_getRetryQueue`,
  `_seedRetryQueue`, `_flushNow`, `_flushRetryNow`, …

### 2.9 Backend

FastAPI on PythonAnywhere (`https://mvfm.pythonanywhere.com`). **Every endpoint is
under `/api/v2`.** `js/config.js` exports `API_BASE_URL` and `API_V2` as the
intended single source of truth. Local dev targets `http://localhost:8080`;
`?api=remote` forces production (honored by `config.js` only — see
[§5](#5-known-inconsistencies)).

| Endpoint | Description |
|---|---|
| `GET /api/v2/timeline` | Timeline events (`?q=`, `?topics=`, `?slugs=`); may include `title`, `eras`, `topics`, `new_events`, `on_this_day`. |
| `GET /api/v2/quip` | Decorative quote for the Résumé tab. |
| `GET /api/v2/findings` | Full Findings collection, event references, and shared topic vocabulary. |
| `GET /api/v2/findings/{slug}` | One finding in a `{finding}` envelope; 404 for unknown/archived slugs. |
| `POST /api/v2/beacon` | Analytics ingestion. |
| `GET /api/v2/analytics/*` | Dashboard query endpoints (Bearer token). |
| `GET /api/v2/content/stats` | Content-catalog shape for dashboard §⑦. |

---

## 3. Technologies

| Area | Choice |
|---|---|
| Language | ES2020+ modules, plain DOM APIs |
| Routing | History API |
| Rendering | `<template>` cloning; `innerHTML` with manual escaping; Canvas 2D; programmatic SVG |
| Platform APIs | `fetch` + `AbortController`, `navigator.sendBeacon`, `crypto.randomUUID`, `ResizeObserver`, `matchMedia('(prefers-reduced-motion)')`, `visibilitychange` / `pagehide` |
| Styling | One `style.css`: CSS custom properties as design tokens, `clamp()` fluid type, Flexbox/Grid, glass-morphism, JS-measured `--topbar-height` |
| Fonts | Google Fonts — PT Sans Narrow + PT Serif (timeline card typography) |
| Charts (dashboard only) | Chart.js 4 via CDN |
| Hosting | GitHub Pages + `spa-github-pages` `404.html` redirect trick |
| Backend | FastAPI on PythonAnywhere |
| Dev server | `npx live-server` on port **3030** (`run.cmd`) |
| Tests | Hand-rolled browser test pages under `tests/` (no runner) |

---

## 4. Design standards, patterns & best practices in use

**Architecture**

- **Single source of truth for chrome** — brand, nav, and shared templates exist
  only in `js/shell.js`; every HTML file is an empty shell.
- **Client-side router with explicit route lifecycle** — `onLoad` / `onUnload`
  hooks; meta/canonical/title kept in sync on every navigation.
- **Progressive enhancement** — server-served `.html` twin per route, `<noscript>`
  fallback content, JSON-LD, sitemap. The site is legible without JS to crawlers.
- **Components own their DOM and lifecycle** — `AITimeline`, `Stage`, `Minimap`,
  `FindingsGraph` each expose `destroy()` and clean up every listener/observer/timer.
- **Dependency injection over imports** — the timeline and findings-graph
  components take every collaborator (colour resolver, tracker, sanitizer,
  callbacks) via an `opts` object and import nothing from `main.js`. They are
  reusable and unit-testable in isolation.
- **Functional-core / imperative-shell** — `scale.js` and `findings-model.js` are
  pure and unit-tested; DOM/canvas work is quarantined in `stage.js`,
  `minimap.js`, `findings-graph.js`, route handlers.
- **Module singletons with test seams** — `analytics.js` is a stateful singleton
  that exports `_`-prefixed inspection/reset helpers for its browser tests.

**Resilience**

- **Non-critical fetches never block render** — the résumé quip and the findings
  topic-colour fetch fail silently and leave a usable page.
- **Bounded retry with failure-class routing** — analytics: 4xx drop, 5xx/network
  retry, queue caps on both pending and retry sides.
- **Beacon on unload** — analytics uses `sendBeacon` / keepalive `fetch`, never
  `async` work in `pagehide`.
- **Coalesced rapid input** — timeline `Stage.show()` uses a generation token so a
  late `transitionend` from a superseded card transition is a no-op.

**Rendering / UX**

- **Design tokens in CSS custom properties**; `clamp()` fluid sizing; components
  resolve colours from CSS variables (`--timeline-focus`, `--clr-accent`, …) with
  hard-coded fallbacks.
- **`prefers-reduced-motion` honored** in the timeline, the findings graph, and
  (implicitly) the GoL step easing.
- **Double-buffered canvas** for flicker-free GoL animation.
- **Virtualization** — the timeline keeps at most two card nodes in the DOM.
- **Deep-linkable state** — search/topics/slug live in the URL (`?q=`, `?topics=`,
  `?slugs=`, `#event-<slug>`), mirrored to `localStorage` for session resume.

**Security-conscious rendering**

- Allow-list sanitizer (`sanitizeTimelineText`) for API-provided event HTML —
  only `b/i/p/a/br/em/strong`, attributes stripped except `href`/`target` on `<a>`.
- `escHtml` on every interpolated string in `innerHTML` template literals.
- External links get `rel="noopener"`; YouTube uses a click-to-load facade with
  `youtube-nocookie.com`.

**Conventions**

- Backend calls go through `/api/v2` (`js/config.js` → `API_V2`).
- In-app links to a timeline entry use `/ai#event-{slug}` (no slash before `#`).
- Timeline searches keep the query-string form `/ai?q=…`.
- `window.timeline.goToId()` must be paired with
  `history.replaceState(null, '', '#event-'+slug)` — it does not touch the URL itself.
- Analytics event names are `snake_case`, domain-prefixed
  (`timeline_*`, `findings_*`, `insights_*`, `contact_*`, `resume_*`).

**State persistence keys**

| Key | Store | Meaning |
|---|---|---|
| `?q=` / `?topics=` / `?slugs=` | URL | Search / topic filter / insight-slug set (mirrored to `localStorage`) |
| `#event-<slug>` | URL hash | Current timeline entry (mirrored to `localStorage`) |
| `lastRoute` | localStorage | Route to restore on `/` |
| `timeline_q` / `timeline_topics` / `timeline_slugs` / `timeline_hash` | localStorage | Mirrors of the URL state above |
| `timeline_modal_date` | localStorage | `YYYY-MM-DD` the What's New / On This Day modal was last dismissed |
| `timeline_modal_dismissed` | localStorage | `"true"` after "Don't show again" |
| `timeline_modal_seen_slugs` | localStorage | JSON array; drives the bell badge |
| `analytics_session_id` / `analytics_referrer` | sessionStorage | Analytics session identity |

---

## 5. Known inconsistencies

Found while auditing the codebase for this document. None is currently breaking
production; all are cleanup / hardening targets. The fix plan is in
[§6](#6-future-enhancements--remediation-plan).

| # | Inconsistency | Where | Impact |
|---|---|---|---|
| I1 | **Dev-server port mismatch.** `package.json` scripts use `3000`; `run.cmd`, `CLAUDE.md`, and `.wmux-url` use `3030`. | `package.json` vs `run.cmd` | Confusing; `npm run dev` serves the wrong port. |
| I2 | **Vestigial `package.json`.** The project policy is "no npm / no Node tooling", yet `package.json` ships `dev`/`serve` scripts, a generic `name`/`author`, `license: ISC`, and a description that only mentions the router + GoL. | `package.json` | Misleading; invites a non-existent workflow. |
| I3 | **Stray `--favicon.png`** (274 KB) in the repo root — a malformed filename (looks like a botched `curl -o`). The real icon is `favicon.png` (2 KB). | repo root (untracked) | Dead weight; risk of committing it. |
| I4 | **Backend base URL derived in three places, divergently.** `js/config.js` is the intended SSOT and honors `?api=remote`. `js/analytics.js` builds its own `ENDPOINT`; `js/dashboard.js` builds its own `API_BASE`. Neither honors `?api=remote`. | `config.js`, `analytics.js`, `dashboard.js` | Local dev can't point analytics/dashboard at production; three copies drift. |
| I5 | **Two slug algorithms, documented as one.** `slugify()` in `js/main.js` folds accents, strips to `[a-z0-9 -]`, and prefixes a leading digit with `_`. The "Event slug derivation" snippet in `CLAUDE.md` keeps `_`, has no accent map, and no digit handling. `deriveEventLabel` assumes the `_` prefix. | `main.js`, `CLAUDE.md`, `findings-model.js` | Docs disagree with code; `referenced_events` slugs can silently fail to match. |
| I6 | **`escHtml` / `esc` reimplemented** independently in `js/main.js`, `js/findings.js`, `js/dashboard.js` (plus inline copies). | 3+ modules | DRY violation; a fix in one copy misses the others. |
| I7 | **Page-lifecycle listeners are inconsistent.** `js/gol.js` uses `beforeunload` (blocks the bfcache); `js/analytics.js` deliberately uses `pagehide` + `visibilitychange`. | `gol.js` vs `analytics.js` | `beforeunload` defeats back/forward cache for the whole page. |
| I8 | **Resolved by Findings API migration: route-teardown asymmetry.** The router supports `onUnload`, but only `ai` defines one. `findings.js` (`wireFilterUI`, `wireDetailDismiss`) attaches `document`-level `keydown`/`click` listeners on every `/findings` visit and never removes them. | `router.js`, `findings.js` | Listener accumulation / leak across repeated navigation (already flagged in `CLAUDE.md`). |
| I9 | **Two "add an article" procedures.** `insights/template.html` exists with `ARTICLE_*` placeholder tokens, but `CLAUDE.md` / older docs say to copy `insights/forwardpropagation.html`. | `insights/`, `CLAUDE.md` | Contributors follow different sources; metadata gets missed. |
| I10 | **`<noscript>` fallbacks duplicate `shell.js` by hand** in `index.html`, `ai.html`, `insights/index.html`, `findings/index.html` — including a hard-coded contact email and a nav list that omits Findings in places. | all shells | Silent drift between the JS UI and the crawler-visible content. |
| I11 | **Leftover `console.*` in production paths** — `js/ui.js` (`"UI behaviors initialized."`), per-attempt fetch logs in `js/main.js`. | `ui.js`, `main.js` | Console noise; leaks internal URLs. |
| I12 | **CDN dependency is unpinned and unverified.** `dashboard.html` loads `chart.js@4` (floating major tag) from jsdelivr with no SRI and no CSP. | `dashboard.html` | Non-reproducible; supply-chain exposure. |
| I13 | **`sendBatch` omits `Content-Type: application/json`.** The `fetch` POST in `analytics.js` sends a JSON string with no header; the beacon path sets it via the `Blob` type. | `analytics.js` | Relies on server content sniffing; the two paths disagree. |
| I14 | **No `.nojekyll`.** GitHub Pages runs the tree through Jekyll. Harmless today, but any future `_`-prefixed asset (or parts of `docs/`) would be silently dropped. | repo root | Latent deploy trap. |
| I15 | **`docs/` (specs + plans) is committed to a public repo**, which conflicts with the stated "don't commit design docs/plans" policy and with `run.cmd --ignore=*.md`. | `docs/` | Policy inconsistency; internal planning is public. |
| I16 | **README (this file, previously) was stale** — referenced KnightLab TimelineJS + CDN, pre-`/api/v2` endpoints, and omitted Findings, `config.js`, `topics.js`, `timeline/*`, and several routes and events. | `README.md` | Fixed by this rewrite; listed so the drift pattern is on record. |
| I17 | **Dashboard token travels in the URL** (`?token=`), so it lands in history, referrer headers, and logs. `robots.txt` `Disallow: /dashboard.html` is not access control. | `dashboard.html`, `dashboard.js` | Credential exposure. |

---

## 6. Future enhancements & remediation plan

Phased so each step is independently shippable and low-risk. The existing browser
test suites (`tests/*.test.html`) cover `analytics.js`, `findings-model.js`, and
`timeline/scale.js`; run them after Phases 2–4.

### Phase 1 — Documentation & zero-risk cleanup

*No behaviour change.*

1. **This README rewrite.** *(done)*
2. **Delete `--favicon.png`** (I3).
3. **Reconcile the dev port to `3030` everywhere**, or delete the `package.json`
   scripts entirely (I1, I2). Decide whether `package.json` should exist at all;
   if kept, make `name`, `description`, `license`, and scripts accurate.
4. **Add `.nojekyll`** to the repo root (I14).
5. **Pick one "add an article" source of truth** — standardise on
   `insights/template.html`, delete the "copy `forwardpropagation.html`"
   instruction, update `CLAUDE.md` and the Insights section here (I9).
6. **Decide `docs/` visibility** — move planning docs out of the repo or add them
   to `.gitignore` per policy (I15).
7. **Document the canonical slug algorithm in exactly one place** and make
   `CLAUDE.md` match `js/main.js` verbatim (I5, doc half).

### Phase 2 — Readability / DRY

*Structural refactors covered by existing tests.*

1. **Extract `js/escape-html.js`** (one `escapeHtml`) and replace the three copies
   in `main.js`, `findings.js`, `dashboard.js` (I6).
2. **Route every backend URL through `js/config.js`.** Delete the private
   `ENDPOINT` in `analytics.js` and `API_BASE` in `dashboard.js`; import `API_V2`.
   This also makes `?api=remote` work for analytics and the dashboard (I4).
3. **Extract `js/slug.js`** with the single canonical `slugify`, imported by
   `main.js`, `timeline/timeline.js`, and `findings-model.js`. Add a unit test
   that pins its output against a table of known headline → slug pairs (I5, code half).
4. **Standardise page-lifecycle handling** on `pagehide` + `visibilitychange`;
   drop `beforeunload` from `gol.js` and restore bfcache eligibility (I7).
5. **Completed with Findings API migration: add a `findings` route `onUnload`.** Have `wireFilterUI` / `wireDetailDismiss`
   return teardown functions and call them on unload; or attach the `document`
   listeners once at module load instead of per navigation (I8).
6. **Strip production `console.*`** or gate it behind a `DEBUG` constant in
   `config.js` (I11).
7. **Generate `<noscript>` blocks and `sitemap.xml`** from `shell.js` + the two
   manifests with a small local script, so the crawler content can't drift from
   the app (I10). (Script runs locally; output is committed — still no build step
   in the serving path.)

### Phase 3 — Performance

1. **Fonts:** self-host PT Sans Narrow + PT Serif (or `font-display: optional`)
   and load them **only on `/ai`**. Removes two render-blocking cross-origin
   requests on every other route.
2. **Cache-busting for ES modules:** append a content hash (`?v=<hash>`) to
   `main.js` and its imports at deploy time, so a partial deploy can't serve a
   stale module graph against a fresh `index.html`.
3. **`findings-graph.js`:** build a neighbour `Map` in the constructor and make
   `_isNeighbor` O(1); it is currently O(N·E) per hover frame (flagged in
   `CLAUDE.md`). Also warn on duplicate `slug` in `buildGraphModel`.
4. **Timeline images:** they are eagerly loaded by design (only two cards exist);
   revisit once entry media counts grow — a small preload window around the
   current index would bound network use during fast scrubbing.
5. **Request count:** optionally concatenate `js/timeline/*` and `js/findings*`
   into one file each at deploy time (still no framework, still readable source),
   or verify HTTP/2 multiplexing on Pages makes this moot.
6. **GoL:** cap the off-screen canvas resolution on very large / hi-DPR viewports
   (currently `dpr` is clamped to 2 but grid size is unbounded).

### Phase 4 — Security / hardening

1. **Content-Security-Policy.** Add a `<meta http-equiv="Content-Security-Policy">`
   (a real header if the host ever allows one) restricting `script-src` to `self`
   + `cdn.jsdelivr.net` (dashboard only), `style-src` `self` + `fonts.googleapis.com`,
   `font-src` `fonts.gstatic.com`, `img-src` `self` `data:` `i.ytimg.com`,
   `frame-src` `youtube-nocookie.com`, `connect-src` `self`
   `mvfm.pythonanywhere.com` `localhost:8080` (I12).
2. **Pin + verify the CDN dependency.** `chart.js@4` → an exact version with
   `integrity` + `crossorigin`; ideally vendor it into `/js/vendor/` and drop the
   CDN (I12).
3. **Harden `sanitizeTimelineText`.** Allow-list `href` schemes (`http`, `https`,
   `mailto`, leading `#`); reject `javascript:` / `data:`. Force
   `rel="noopener noreferrer"` on every rendered `<a>` (currently only `noopener`).
4. **Move the dashboard token out of the URL** (I17). Prompt for it once, keep it
   in `sessionStorage`, and strip `?token=` from the address bar with
   `replaceState`. Treat `robots.txt` as SEO only, never as an access boundary.
5. **`analytics.js`:** send `Content-Type: application/json` on the `fetch` path
   so both transports agree (I13).
6. **External media:** apply `referrerpolicy="no-referrer"` and `loading="lazy"`
   consistently to third-party images/iframes.

### Phase 5 — Standardisation / process

1. **CI:** a GitHub Actions workflow that serves the repo and runs the four
   `tests/*.test.html` suites headless (Playwright or `puppeteer`) on every PR.
   The tests exist; nothing runs them automatically today.
2. **Formatting:** check in a Prettier config + `.editorconfig` and a
   format-check CI step. Pick one quote style, indent, and semicolon rule
   (the codebase is close but not uniform).
3. **`CONVENTIONS.md`** (or a pinned section here) as the single home for: the
   slug rules, analytics event-name grammar, topic-colour/acronym derivation, the
   template SSOT rule, the `/api/v2` prefix rule, and the `/ai#event-` link form.
4. **Backend contract:** capture the expected `/api/v2/timeline` response shape
   (fields consumed: `events[]`, `title`, `eras`, `topics`, `new_events`,
   `on_this_day`) in one document so the frontend and FastAPI app stay in sync.
5. **Manifest linting:** a local check that every `referenced_events` slug in
   `insights/manifest.json` and `findings/manifest.json` resolves against the
   live timeline (catches I5-class mismatches before they ship).

---

## 7. Running locally

```bash
run.cmd
```

Runs `npx live-server . --port=3030 --entry-file=index.html --ignore=*.md` and
serves at `http://localhost:3030`. No build, no `npm install`.

Check whether the server is already running on port 3030 before starting a new
one — it usually is.

### Tests

Browser-based, no runner. With the dev server up:

```
http://localhost:3030/tests/analytics.test.html
http://localhost:3030/tests/findings.test.html
http://localhost:3030/tests/findings-api.test.html
http://localhost:3030/tests/timeline-scale.test.html
http://localhost:3030/tests/timeline.test.html
```

### WMux (optional)

[WMux](https://github.com/amirlehmam/wmux) is a Windows terminal multiplexer with
a live browser panel, driven over the named pipe `\\.\pipe\wmux` (JSON-RPC).
`.wmux-url` holds the URL the session opens to. See `~/.claude/wmux.md`.

---

## 8. File map

| Path | Purpose |
|---|---|
| `index.html` | Root SPA shell. |
| `ai.html` | SPA shell pre-titled for `/ai`; rewrites `/ai.html` → `/ai`. |
| `404.html` | `spa-github-pages` redirect shim for client-side routes. |
| `dashboard.html` + `js/dashboard.js` | Token-gated analytics dashboard (Chart.js). |
| `style.css` | All styles. Design tokens + glass-morphism + sticky header. |
| `js/shell.js` | SSOT for brand, nav, and common tab templates. |
| `js/main.js` | App init, route table, AI-timeline route handler, timeline modal, Insights listing. |
| `js/router.js` | History API router + route lifecycle. |
| `js/config.js` | Backend base URL / `API_V2` (intended SSOT). |
| `js/analytics.js` | Event batching + Beacon flush + retry queue. |
| `js/topics.js` | `getTopicColor`, `generateMnemonics`, `getTopicInitials`. |
| `js/ui.js` | Sticky/shrinking header; `--topbar-height`. |
| `js/gol.js` | Game of Life background + 7-segment stats. |
| `js/timeline/` | Bespoke AI timeline: `scale.js` (pure), `minimap.js`, `stage.js`, `timeline.js`. |
| `js/findings.js` / `js/findings-model.js` / `js/findings-graph.js` | Findings route, pure model, canvas force-graph. |
| `js/findings-api.js` | Findings API contract validation, requests, and safe source URLs. |
| `insights/` | `manifest.json`, `index.html`, `template.html`, one `<slug>.html` per essay. |
| `findings/` | `manifest.json`, `index.html`. |
| `tests/` | Browser test pages + fixtures. |
| `docs/` | Design specs and implementation plans (see I15). |
| `sitemap.xml`, `robots.txt`, `CNAME` | SEO / hosting config. |
