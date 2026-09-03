# CLAUDE.md

## Development

```bash
npx live-server . --port=3030 --entry-file=index.html
```

No build step — pure vanilla HTML/CSS/JS, GitHub Pages.

**Do not run any git commands** — user handles version control manually.

Before starting the server, check if it's already running on port 3030 — it usually is.

If WMux is active (see global `~/.claude/CLAUDE.md`) and port 3030 is responding, run the smart navigation at session start: call `browser.eval` with `window.location.href` — if the result does not start with `http://localhost:3030`, navigate to `http://localhost:3030/ai`. This auto-creates the browser panel if needed and skips navigation if already on the right origin. See the "Smart navigation" pattern in `~/.claude/wmux.md`.

### Tests

Browser-based only — no npm, no test runner:

```
http://localhost:3030/tests/analytics.test.html
```

## Architecture

**SPA with ES6 modules, no framework, no bundler.**

- `index.html` — SPA shell; brand/nav/templates are empty stubs filled by `js/shell.js` at runtime
- `404.html` — GitHub Pages redirect hack for client-side routing
- `js/shell.js` — Single source of truth for brand text, nav items, and all common tab templates (Home, Contact, Résumé, AI, Insights); called as the first step in `DOMContentLoaded` via `injectShell()`
- `js/router.js` — History API router; restores last route from localStorage; fires `page_view` on every navigation except initial load; detects `window.__FEATURE_SLUG__` to activate the `insights-article` route (not persisted to `lastRoute`)
- `js/analytics.js` — Batches events, POSTs to `/api/beacon` every 5s; uses Beacon API on tab close; session ID in `sessionStorage`
- `js/gol.js` — Conway's Game of Life background canvas animation
- `js/main.js` — App init, AI timeline fetch/filter/search, Insights listing, route definitions; mounts the bespoke `AITimeline` component (`js/timeline/`); imports `injectShell` from `shell.js`
- `js/ui.js` — Sticky header scroll behavior; measures `#topBar` height after shrink transition and sets `--topbar-height` CSS custom property
- `dashboard.html` + `js/dashboard.js` — Internal analytics dashboard (token-protected via `?token=`); see [Analytics Dashboard](#analytics-dashboard) below

### Insights Articles

Static HTML pages in `insights/` for SEO (Google indexing). The directory contains:

- `manifest.json` — JSON array of article descriptors (`{slug, title, description, date, topics[], referenced_events[]}`); **this is the data source for the JS-rendered card listing** on the Insights tab (`insightsRouteOnLoad` in `js/main.js` fetches it at `/insights/manifest.json`). The optional `referenced_events` array lists timeline event slugs (e.g. `"backpropagation-i"`) that the article covers — the AI tab reads this to show a purple left-edge stripe and chip on those entries.
- `index.html` — Insights listing page; same SPA shell as `index.html`; `<noscript>` block is the crawler-only fallback
- `<slug>.html` — one file per article

Each article page:

- Uses the same SPA shell as `index.html` (empty brand/menu stubs — filled by `js/shell.js`)
- Does **not** contain any of the 5 common tab templates (Home, Contact, Résumé, AI, Insights) — `injectShell()` injects these at runtime
- Defines one unique `<template id="tpl-feature">` with the article content
- Sets `window.__FEATURE_SLUG__ = '<slug>'` before loading `js/main.js` — the router uses this to activate the `insights-article` route and render the article template directly
- Fires `insights_entry_view` analytics event with `{ slug }` on load

**Adding a new article:**
1. Copy `insights/forwardpropagation.html`, update all metadata (title, description, canonical URL, OG/Twitter tags, JSON-LD, `datePublished`, `__FEATURE_SLUG__`)
2. Replace the `<template id="tpl-feature">` body with the article content
3. Add an entry to `insights/manifest.json` — this drives the JS-rendered card listing on the Insights tab. Include a `referenced_events` array with the slugs of any timeline entries the article covers; those entries will automatically show the purple stripe and chip.
4. Add the article to the `<noscript>` block in `insights/index.html` (crawler fallback only)
5. Add a `<url>` entry to `sitemap.xml` — sitemaps require explicit URLs; link discovery via `<noscript>` works but the sitemap gives Google a faster, more reliable signal

### Findings

A curated list of external links plus a hand-rolled force-directed graph, at `/findings`. Route wired in `js/main.js` (`findingsRouteOnLoad` from `js/findings.js`); nav item + `tpl-findings` template live in `js/shell.js`.

- `findings/manifest.json` — JSON array, newest-first. One object per finding: `{ slug, title, url, source, date_added, note, topics[], referenced_events[], referenced_insights[] }`. `topics` use the shared timeline/insights vocabulary; `referenced_events` are timeline event slugs (same derivation as everywhere — see [Timeline Links](#timeline-links)); `referenced_insights` are `insights/manifest.json` slugs. Both arrays drive graph edges; `referenced_events` also lights the purple stripe/chip on the AI tab.
- `findings/index.html` — crawler page: same SPA shell as `insights/index.html` plus a `<noscript>` `<li>` list. Keep that list and the `sitemap.xml` `/findings` entry in sync when adding findings (same rule as Insights).
- `js/findings-model.js` — pure, unit-tested in `tests/findings.test.html`: `deriveEventLabel` (un-slugify + `TOPIC_LABEL_OVERRIDES` for acronym-y event slugs — ships empty), `buildGraphModel`, `filterFindings`.
- `js/findings-graph.js` — `FindingsGraph`, a canvas force simulation. **Imports nothing from app code** — palette, the `topicColor` resolver, and click callbacks all arrive via the `opts` object. Honours `prefers-reduced-motion` (static settled layout), pauses on tab hide, and self-disposes when its canvas leaves the DOM.
- `js/findings.js` — route handler: fetches both manifests, renders the list + filters + detail panel, instantiates the graph, and fires a **non-blocking** `/timeline` fetch purely to colour and acronym-label topics identically to the AI tab (everything stays neutral grey if the backend is unreachable — never blocks render).
- `js/topics.js` / `js/config.js` — `getTopicColor`, `generateMnemonics` / `getTopicInitials`, and `API_BASE_URL`, all extracted from `main.js` and shared, so the Findings tab and the AI tab produce identical topic colours and acronyms.

**Analytics events:** `page_view` (automatic via the router), `finding_view {slug}`, `finding_source_visit {slug,url}`, `findings_filter {query,active_topics,result_count}`, `findings_graph_node_click {node_type,id}`, `findings_graph_nav {node_type,slug}`, `findings_map_toggle {to}`.

**Adding a finding:**
1. Prepend an object to `findings/manifest.json`.
2. Add a matching `<li>` to the `<noscript>` block in `findings/index.html` (write `&` as `&amp;`).
3. Bump `<lastmod>` on the `/findings` `<url>` in `sitemap.xml`.
4. For a YouTube link, get the real title + channel from `https://www.youtube.com/oembed?url=<watch-url>&format=json` (the watch page itself scrapes to footer junk).
5. Add to `TOPIC_LABEL_OVERRIDES` in `js/findings-model.js` **only** if an event node's auto-derived label reads wrong (e.g. `gpt-4` → "Gpt 4").

**Known deferred cleanups** (safe to ship, none load-bearing): `FindingsGraph._isNeighbor` is O(N·E) per hover frame — build a neighbour `Map` in the constructor before the manifest passes ~50 findings; `wireFilterUI()` / `wireDetailDismiss()` re-attach `document`-level listeners on every `/findings` route load (no SPA route-teardown hook exists); `buildGraphModel` doesn't warn on a duplicate `slug` in the manifest.

### CSS Sticky Notes

Key rules that must not be broken:

- `.app { overflow-x: clip }` — **must be `clip`, not `hidden`**. `overflow-x: hidden` promotes `.app` to a scroll container, which breaks `position: sticky` on child elements.
- All bare `header {}` element rules are scoped to `#topBar header {}` — a bare `header` selector would match `.insight-article-header` too, collapsing it when `.scrolled` is applied.
- `.insight-article-header` uses `top: calc(var(--topbar-height, 6.25rem) + 0.5rem)` — `--topbar-height` is set by `js/ui.js` after the shrink transition completes.

### Backend

FastAPI on PythonAnywhere (`https://mvfm.pythonanywhere.com`). Key endpoints:
- `GET /timeline` — AI history events (`?q=`, `?topics=`)
- `GET /quip` — Decorative quote shown on the Resume tab
- `POST /api/beacon` — Analytics ingestion
- `GET /api/*` — Dashboard query endpoints (Bearer token required)
- `GET /api/analytics/timeline` — includes `entry_views_per_day` (`[{date, count}]`): aggregate timeline event views per day
- `GET /api/analytics/timeline/entries/{slug}` — same shape for a single entry; slug is the event ID without the `event-` prefix (e.g. `claude-code-source-leak`); response includes `entry_title` and `entry_views_per_day` (or `views_per_day`)

Local dev hits `http://localhost:8080`; override with `?api=remote`.

### Timeline Links

When linking from prose to a specific timeline entry, use `/ai#event-{slug}`. Do **not** insert a slash between `ai` and the hash.

Examples:

- Correct: `/ai#event-backpropagation-i`
- Incorrect: `/ai/#event-backpropagation-i`

**Event slug derivation:** The `/timeline` API response does **not** include a `unique_id` field on events. The frontend derives the event slug from the headline in `js/main.js` using a slugify function (lowercase, spaces → hyphens, non-word non-hyphen chars stripped). This slug is used for `referenced_events` lookups and analytics data attributes:

```js
const eventSlug = event.unique_id || (event.text?.headline || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
```

The slugs in `referenced_events` must match what this formula produces for the event's headline.

Timeline searches keep the query-string form, for example `/ai?q=backpropagation`.

**`goToId` does not update the URL.** `window.timeline.goToId(slug)` scrolls to an entry but never touches `window.location`. Always pair it with `history.replaceState(null, '', \`#event-${slug}\`)` so the address bar stays in sync and the link is shareable.

### AI Timeline component (`js/timeline/`)

Bespoke, virtualized — replaced KnightLab TimelineJS in Sept 2026 (see
`docs/superpowers/specs/2026-09-03-bespoke-timeline-design.md`).

- `scale.js` — pure. Date-sorted events → warped axis positions in `[0,1]`.
  Gap between consecutive entries gets width `lerp(realTimeGap, equalGap, ALPHA=0.6)`,
  recomputed on every `setEvents`. No hard-coded dates. Unit-tested in
  `tests/timeline-scale.test.html`.
- `minimap.js` — one `<canvas>`: 3 group lanes (research/industry/pop culture),
  faint era bands, draggable/resizable focus window, playhead, adaptive year
  ticks. Continuous wheel/pinch/drag zoom. Imports only `scale.js`.
- `stage.js` — renders exactly one event's card (image / YouTube facade / link
  media; sanitized `b/i/p/a/br` text; topic pills; insight chip + stripe;
  purchase cart; archived ribbon). Never more than 2 card nodes in the DOM.
- `timeline.js` — `AITimeline`. Public API mirrors what `main.js` calls on
  `window.timeline`: `setEvents(data)`, `goToId(slug)`, `getCurrentSlide()`,
  `on('change', cb)`, `destroy()`. `setEvents` fires the initial `'change'` on a
  microtask. Colours resolve from `--timeline-focus` (default `--clr-accent`).

Analytics: all prior `timeline_*` events preserved, plus
`timeline_zoom { f0, f1, entries_in_view }` (debounced on zoom settle).

The `/ai` route no longer loads any CDN. `#event-<slug>` deep-linking and the
`?q` / `?topics` / `?slugs` flow are unchanged.

### State Persistence

- `?q=` / `?topics=` — search and topic filter (also mirrored to `localStorage`)
- `#event-<id>` — current timeline event (also mirrored to `localStorage`)
- `lastRoute` in `localStorage` — restored on root path load
- `timeline_modal_date` in `localStorage` — date (YYYY-MM-DD) the modal was last dismissed; modal is suppressed if it matches today
- `timeline_modal_dismissed` in `localStorage` — `"true"` if user selected "Don't show again"

### Analytics Dashboard

`dashboard.html` + `js/dashboard.js`. Seven sections rendered with Chart.js 4:

| # | Section | Refresh group |
|---|---------|--------------|
| ① | Traffic Overview | 5 min |
| ② | Session Behavior | 5 min |
| ③ | Audience & Geography | 15 min |
| ④ | AI Timeline Engagement | 15 min |
| ⑤ | Conversion Funnel | 15 min |
| ⑥ | Recent Sessions | 5 min |
| ⑦ | Content Catalog | 60 min |

**Section ⑦ — Content Catalog** visualises the shape and editorial health of the AI timeline content catalog. It does **not** respond to the date range selector — it always shows full catalog stats. Data source: `GET /api/content/stats` (Bearer token, no date params). Three sub-sections:

- **Composition** — doughnut (`by_group`: research / industry / pop culture) + horizontal bar (`by_topic`, top 10)
- **Over time** — stacked bar (`by_group_per_decade` or `by_group_per_year`) with a Decades / Years toggle; gap year count shown below chart
- **Connections & health** — custom HTML heatmap grid of topic co-occurrence (`topic_pairs`, top 8 topics in card / full in modal) + "Research without source" KPI card (opens zoom modal listing all entries from `research_without_source.entries`)

All five chart cards open zoom modals: `contentByGroup`, `contentByTopic`, `contentTemporal`, `contentTopicHeatmap`, `contentMissingSource`.

**`openModal` sentinel** — two cards in Section ⑦ have no Chart.js instance. They are mapped to the sentinel string `'_contentStats'` in the chartId lookup; `openModal` resolves raw data from `_contentStatsRaw` (module-level cache, mirrors `_funnelRaw`).

**`centerText` Chart.js plugin** — registered once at module level (not inside `loadGeo`). Draws a large number + label in the center of doughnut charts. Supports an optional `label` key in the plugin options (defaults to `'sessions'`); Section ⑦ passes `label: 'entries'`.

**`buildTopicHeatmapHtml(pairs, topN = null)`** — standalone helper that builds the co-occurrence heatmap as a CSS grid. `topN = null` renders all topics (modal); `topN = 8` renders compact card view. `compact` mode is determined by `topN !== null`.

**Section ④ — AI Timeline Engagement** has two additional features beyond the standard charts:

- **Event views over time** — full-width amber line chart at the bottom of the section; shows aggregate `entry_views_per_day` from `/api/analytics/timeline`. Missing dates and trailing days up to today are filled with 0.
- **Per-entry drilldown modal** — opened by clicking any bar in "Top 10 viewed events" (pre-filled) or via the "⌕ look up" button on that card (blank). Fetches `/api/analytics/timeline/entries/{slug}` on demand. The search input expects a **slug** (e.g. `claude-code-source-leak`), not a title. Same date-filling logic applies.

**Zoom modal** — clicking most chart cards opens a full-screen modal with a larger chart and raw-data table. Clicking a bar in "Top 10 viewed events" opens the per-entry drilldown instead; clicking elsewhere on that card still opens the zoom.

**Date ranges** — 7d / 30d / All / Custom via header buttons. All `fillDates` calls respect `_currentRange` and always extend to today.

### Timeline Modal

Shown on AI tab load when the `/timeline` response includes `new_events` or `on_this_day` arrays (never present in filtered/search responses). Has two tabs: "What's New" and "On This Day". Implemented in `js/main.js` (`showTimelineModal`) and styled in `style.css`. Hero image: `img/modal-hero.jpg`.

A bell icon button (`#modal-bell-btn`) sits in the `view-header` to the right of the search toggle. It lets users manually reopen the modal at any time, bypassing the date/dismissed suppression flags. A pink badge dot (`#modal-bell-badge`) appears when the current API response contains slugs not yet in `timeline_modal_seen_slugs`.

**localStorage keys:**
- `timeline_modal_date` — date (YYYY-MM-DD) the modal was last dismissed; modal is suppressed if it matches today
- `timeline_modal_dismissed` — `"true"` if user selected "Don't show again"
- `timeline_modal_seen_slugs` — JSON array of slugs from `new_events` + `on_this_day` seen the last time the modal was opened (controls badge visibility)

**Reset for testing (run in browser DevTools console):**

```javascript
localStorage.removeItem('timeline_modal_date');        // show again today
localStorage.removeItem('timeline_modal_dismissed');   // re-enable after "Don't show again"
localStorage.removeItem('timeline_modal_seen_slugs');  // show badge again (mark all as unseen)
```
