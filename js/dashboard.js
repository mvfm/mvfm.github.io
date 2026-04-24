// js/dashboard.js

// ── Config ────────────────────────────────────────────────────────────────────
const _isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_BASE = _isLocal ? 'http://localhost:8080' : 'https://mvfm.pythonanywhere.com';
const TOKEN = new URLSearchParams(location.search).get('token') || '';  // from ?token= in URL

// ── State ─────────────────────────────────────────────────────────────────────
let _lastRefresh = Date.now();
let _currentRange = { type: '7d' };  // { type: '7d'|'30d'|'all'|'custom', from?, to? }
let _funnelRaw = null;               // cached for zoom modal (no chart instance to attach to)
let _entryModalChart = null;
let _timelineTopEvents = [];
let _contentStatsRaw  = null;
let _contentDecadeView = true;

// ── URL helpers ───────────────────────────────────────────────────────────────
function buildUrl(path, extraParams = {}) {
  const url = new URL(API_BASE + path);
  const r = _currentRange;
  if (r.type === 'all') {
    url.searchParams.set('range', 'all');
  } else if (r.type === 'custom' || r.type === '7d' || r.type === '30d') {
    url.searchParams.set('from', r.from);
    url.searchParams.set('to', r.to);
  }
  Object.entries(extraParams).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function rangeForPreset(preset) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  if (preset === '7d')  return { type: '7d',  from: fmt(new Date(today - 6*864e5)),  to: fmt(today) };
  if (preset === '30d') return { type: '30d', from: fmt(new Date(today - 29*864e5)), to: fmt(today) };
  if (preset === 'all') return { type: 'all' };
  return null;
}

// ── Fetch with error handling ─────────────────────────────────────────────────
async function apiFetch(path, params = {}) {
  const url = buildUrl(path, params);
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Skeleton / error helpers ──────────────────────────────────────────────────
function showSkeleton(el) {
  el.innerHTML = '<div class="skeleton skeleton-block"></div>';
}

function showError(el, msg = 'Failed to load — check your token or try refreshing.') {
  el.innerHTML = `<p class="section-error">⚠ ${escHtml(msg)}</p>`;
}

// ── KPI card builder ──────────────────────────────────────────────────────────
function kpiCard(label, value, deltaHtml) {
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-delta">${deltaHtml}</div>
    </div>`;
}

function deltaBadge(pct, unit = '%') {
  if (!pct) return `<span class="delta-flat">— stable</span>`;
  const sign = pct > 0 ? '↑' : '↓';
  const cls  = pct > 0 ? 'delta-up' : 'delta-down';
  return `<span class="${cls}">${sign} ${Math.abs(pct)}${unit} vs prev period</span>`;
}

function fmtDuration(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

function relativeTime(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  const todayStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart - 864e5);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const localTime = `${hh}:${mm}`;
  if (d >= todayStart)     return 'today ' + localTime;
  if (d >= yesterdayStart) return 'yesterday ' + localTime;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const EVENT_ABBR = {
  timeline_event_view:           'event_view',
  timeline_search:               'search',
  timeline_purchase_click:       'cart_click',
  timeline_purchase_option_click:'option_click',
};

function fmtEventSummary(summary) {
  return Object.entries(summary)
    .map(([k, v]) => `${EVENT_ABBR[k] || k}×${v}`)
    .join(', ');
}

// ── Date range controls ───────────────────────────────────────────────────────
function initDateRange() {
  const params = new URLSearchParams(location.search);
  if (params.get('range') === 'all') {
    _currentRange = { type: 'all' };
    setActiveRangeBtn('all');
  } else if (params.get('from') && params.get('to')) {
    _currentRange = { type: 'custom', from: params.get('from'), to: params.get('to') };
    setActiveRangeBtn('custom');
    document.getElementById('from-date').value = params.get('from');
    document.getElementById('to-date').value   = params.get('to');
    document.getElementById('custom-range').style.display = 'flex';
  } else {
    _currentRange = rangeForPreset('7d');
    setActiveRangeBtn('7d');
  }

  document.querySelectorAll('.range-btn[data-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.range;
      if (preset === 'custom') {
        document.getElementById('custom-range').style.display = 'flex';
        return;
      }
      document.getElementById('custom-range').style.display = 'none';
      _currentRange = rangeForPreset(preset);
      setActiveRangeBtn(preset);
      persistRangeToUrl();
      refreshAll();
    });
  });

  document.getElementById('apply-custom').addEventListener('click', () => {
    const from = document.getElementById('from-date').value;
    const to   = document.getElementById('to-date').value;
    if (!from || !to) return;
    _currentRange = { type: 'custom', from, to };
    setActiveRangeBtn('custom');
    persistRangeToUrl();
    refreshAll();
  });

  document.getElementById('refresh-btn').addEventListener('click', refreshAll);
}

function setActiveRangeBtn(active) {
  document.querySelectorAll('.range-btn[data-range]').forEach(b => {
    b.classList.toggle('active', b.dataset.range === active);
  });
}

function persistRangeToUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('from');
  url.searchParams.delete('to');
  url.searchParams.delete('range');
  if (_currentRange.type === 'all') {
    url.searchParams.set('range', 'all');
  } else if (_currentRange.from) {
    url.searchParams.set('from', _currentRange.from);
    url.searchParams.set('to',   _currentRange.to);
  }
  history.replaceState({}, '', url);
}

// ── Last updated ticker ───────────────────────────────────────────────────────
function startUpdatedTicker() {
  const el = document.getElementById('last-updated');
  setInterval(() => {
    const mins = Math.floor((Date.now() - _lastRefresh) / 60000);
    el.textContent = mins < 1 ? 'Updated just now' : `Updated ${mins}m ago`;
  }, 30000);
}

// ── Chart registry (track instances for destroy-on-redraw) ───────────────────
const _charts = {};
Chart.register({
  id: 'centerText',
  beforeDraw(chart) {
    const opts = chart.config.options?.plugins?.centerText;
    if (!opts?.totalSessions) return;
    const { ctx, chartArea: { top, bottom, left, right } } = chart;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    ctx.save();
    ctx.font = 'bold 14px system-ui';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(opts.totalSessions.toLocaleString(), cx, cy - 4);
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#64748b';
    ctx.fillText(opts.label ?? 'sessions', cx, cy + 12);
    ctx.restore();
  }
});
function makeChart(id, config) {
  if (_charts[id]) _charts[id].destroy();
  _charts[id] = new Chart(document.getElementById(id), config);
  return _charts[id];
}

// ── Section ①: Traffic Overview ──────────────────────────────────────────────
async function loadTraffic() {
  const kpis = document.getElementById('traffic-kpis');
  showSkeleton(kpis);

  try {
    const d = await apiFetch('/api/analytics/traffic');

    kpis.innerHTML =
      kpiCard('Sessions',          d.sessions.toLocaleString(),              deltaBadge(d.sessions_delta_pct)) +
      kpiCard('Page Views',        d.page_views.toLocaleString(),            deltaBadge(d.page_views_delta_pct)) +
      kpiCard('Avg Pages/Session', d.avg_pages_per_session.toFixed(1),       deltaBadge(d.avg_pages_delta_pct));

    makeChart('chart-views-over-time', {
      type: 'line',
      data: {
        labels: d.views_per_day.map(r => r.date),
        datasets: [{
          data: d.views_per_day.map(r => r.count),
          borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)',
          tension: 0.3, fill: true, pointRadius: 2,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569', maxTicksLimit: 7 } },
          y: { ticks: { color: '#475569' } },
        },
      },
    });

    makeChart('chart-views-by-route', {
      type: 'bar',
      data: {
        labels: d.views_by_route.map(r => r.route),
        datasets: [{ data: d.views_by_route.map(r => r.pct), backgroundColor: 'rgba(99,102,241,0.6)' }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569', callback: v => v + '%' }, max: 100 },
          y: { ticks: { color: '#94a3b8' } },
        },
      },
    });

    _charts['chart-views-over-time']._raw = d;
    _charts['chart-views-by-route']._raw = d;

  } catch (e) {
    showError(kpis, e.message);
  }
}

// ── Section ②: Session Behavior ──────────────────────────────────────────────
async function loadBehavior() {
  const kpis = document.getElementById('behavior-kpis');
  showSkeleton(kpis);

  try {
    const d = await apiFetch('/api/analytics/sessions/behavior');

    kpis.innerHTML =
      kpiCard('Median Duration',    fmtDuration(d.median_duration_s),          deltaBadge(d.median_duration_delta_s, 's')) +
      kpiCard('Bounce Rate',        d.bounce_rate_pct + '%',                   deltaBadge(d.bounce_rate_delta_pct)) +
      kpiCard('Avg Events/Session', d.avg_events_per_session.toFixed(1),       deltaBadge(d.avg_events_delta));

    const barOpts = (color) => ({
      type: 'bar',
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569' } },
          y: { ticks: { color: '#475569' } },
        },
      },
      data: { datasets: [{ backgroundColor: color }] },
    });

    const titleOpts = (text) => ({ display: true, text, color: '#64748b', font: { size: 10 } });

    const durCfg = barOpts('rgba(168,85,247,0.65)');
    durCfg.data.labels = d.duration_buckets.map(b => b.label);
    durCfg.data.datasets[0].data = d.duration_buckets.map(b => b.count);
    durCfg.options.scales.x.title = titleOpts('Duration');
    durCfg.options.scales.y.title = titleOpts('Sessions');
    makeChart('chart-duration-dist', durCfg);

    const evtCfg = barOpts('rgba(168,85,247,0.65)');
    evtCfg.data.labels = d.events_per_session_buckets.map(b => b.label);
    evtCfg.data.datasets[0].data = d.events_per_session_buckets.map(b => b.count);
    evtCfg.options.scales.x.title = titleOpts('Events');
    evtCfg.options.scales.y.title = titleOpts('Sessions');
    makeChart('chart-events-per-session', evtCfg);

    _charts['chart-duration-dist']._raw = d;
    _charts['chart-events-per-session']._raw = d;

  } catch (e) {
    showError(kpis, e.message);
  }
}

// ── Section ③: Geo ────────────────────────────────────────────────────────────
const GEO_COLORS = ['#ec4899','#6366f1','#f59e0b','#10b981','#3b82f6','#ef4444','#8b5cf6'];
const GEO_COLORS_LIGHT = ['rgba(236,72,153,0.45)','rgba(99,102,241,0.45)','rgba(245,158,11,0.45)','rgba(16,185,129,0.45)','rgba(59,130,246,0.45)','rgba(239,68,68,0.45)','rgba(139,92,246,0.45)'];

async function loadGeo() {
  try {
    const d = await apiFetch('/api/analytics/geo');

    const outerData   = d.countries.map(c => c.sessions);
    const outerColors = d.countries.map((_, i) => GEO_COLORS[i % GEO_COLORS.length]);
    const outerLabels = d.countries.map(c => `${c.name} (${c.code})`);

    const innerData = [], innerColors = [], innerLabels = [], innerCountryLabels = [];
    d.countries.forEach((c, i) => {
      c.cities.forEach(city => {
        innerData.push(city.sessions);
        innerColors.push(GEO_COLORS_LIGHT[i % GEO_COLORS_LIGHT.length]);
        innerLabels.push(`${city.name} (${c.code})`);
        innerCountryLabels.push(`${c.name} (${c.code})`);
      });
    });

    makeChart('chart-geo-doughnut', {
      type: 'doughnut',
      data: {
        datasets: [
          { data: outerData, backgroundColor: outerColors, label: 'Countries' },
          { data: innerData, backgroundColor: innerColors, label: 'Cities' },
        ],
      },
      options: {
        cutout: '40%',
        plugins: {
          legend: { display: false },
          centerText: { totalSessions: d.total_sessions },
          tooltip: {
            callbacks: {
              title: items => {
                const item = items[0];
                return item.datasetIndex === 0
                  ? outerLabels[item.dataIndex]
                  : innerCountryLabels[item.dataIndex];
              },
              label: ctx => {
                const lbl = ctx.datasetIndex === 0 ? outerLabels[ctx.dataIndex] : innerLabels[ctx.dataIndex];
                return ` ${lbl}: ${ctx.parsed}`;
              }
            }
          }
        },
      },
    });

    document.getElementById('geo-error').innerHTML = '';

    const maxCount = Math.max(...d.hourly_sessions.map(h => h.count), 1);
    const grid = document.getElementById('heatmap-grid');
    if (!grid) return;
    grid.innerHTML = d.hourly_sessions.map(h => {
      const intensity = h.count / maxCount;
      return `<div class="heatmap-cell"
        style="background:rgba(236,72,153,${0.08 + intensity * 0.85})"
        data-label="${h.hour}:00 — ${h.count} sessions"></div>`;
    }).join('');

    _charts['chart-geo-doughnut']._raw = d;

  } catch (e) {
    showError(document.getElementById('geo-error'), e.message);
  }
}

// ── Section ④: AI Timeline Engagement ────────────────────────────────────────
async function loadTimeline() {
  const kpis = document.getElementById('timeline-kpis');
  showSkeleton(kpis);
  try {
    const d = await apiFetch('/api/analytics/timeline');

    kpis.innerHTML =
      kpiCard('Searches',      d.total_searches.toLocaleString(),         '') +
      kpiCard('Event Views',   d.total_event_views.toLocaleString(),      '') +
      kpiCard('Topic Filters', d.total_topic_filter_uses.toLocaleString(), '');

    _timelineTopEvents = d.top_events;
    makeChart('chart-top-events', {
      type: 'bar',
      data: {
        labels: d.top_events.map(e => e.event_title),
        datasets: [{ data: d.top_events.map(e => e.views), backgroundColor: 'rgba(245,158,11,0.65)' }],
      },
      options: {
        onClick: (e, elements) => {
          if (elements.length) {
            e.native.stopPropagation();
            const entry = d.top_events[elements[0].index];
            openEntryModal(entry.event_id, entry.event_title);
          }
        },
        onHover: (e, elements) => {
          e.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569', maxRotation: 30 } },
          y: { ticks: { color: '#475569' } },
        },
      },
    });

    const entryPerDay = fillDates(d.entry_views_per_day ?? []);
    makeChart('chart-entry-views-over-time', {
      type: 'line',
      data: {
        labels: entryPerDay.map(r => r.date),
        datasets: [{
          data: entryPerDay.map(r => r.count),
          borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)',
          tension: 0.3, fill: true, pointRadius: 2,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569', maxTicksLimit: 7 } },
          y: { ticks: { color: '#475569' } },
        },
      },
    });

    const searchList = document.getElementById('top-searches-list');
    searchList.innerHTML = d.top_searches.map(s =>
      `<div class="ranked-row"><span class="label">"${s.query}"</span><span class="value" style="color:var(--amber)">${s.count}</span></div>`
    ).join('');

    const zeroList = document.getElementById('zero-results-list');
    zeroList.innerHTML = d.zero_result_searches.length
      ? d.zero_result_searches.map(s =>
          `<div class="ranked-row"><span class="label">"${s.query}"</span><span class="value" style="color:var(--red)">×${s.count}</span></div>`
        ).join('')
      : '<div style="font-size:0.65rem;color:var(--faint)">None — great coverage!</div>';

    makeChart('chart-topic-filters', {
      type: 'bar',
      data: {
        labels: d.topic_filter_popularity.map(t => t.topic),
        datasets: [{ data: d.topic_filter_popularity.map(t => t.uses), backgroundColor: 'rgba(245,158,11,0.55)', indexAxis: 'y' }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569' } },
          y: { ticks: { color: '#94a3b8' } },
        },
      },
    });

    _charts['chart-top-events']._raw = d;
    _charts['chart-topic-filters']._raw = d;
    _charts['chart-entry-views-over-time']._raw = d;

  } catch (e) {
    showError(kpis, e.message);
  }
}

// ── Section ⑤: Conversion Funnel ─────────────────────────────────────────────
async function loadFunnel() {
  const wrap  = document.getElementById('funnel-bars');
  const tbody = document.querySelector('#purchase-table tbody');
  wrap.innerHTML = '<div class="skeleton skeleton-block"></div>';
  try {
    const d = await apiFetch('/api/analytics/funnel');
    _funnelRaw = d;
    const maxVal = d.event_views || 1;

    const funnelRow = (label, count, pct, color) => `
      <div class="funnel-bar-row">
        <div class="funnel-bar-label">${label}</div>
        <div class="funnel-bar-track">
          <div class="funnel-bar-fill" style="background:${color};width:${count/maxVal*100}%">
            ${count.toLocaleString()} · ${pct}%
          </div>
        </div>
      </div>`;

    wrap.innerHTML =
      funnelRow('Event views',   d.event_views,   100,                     'rgba(16,185,129,0.8)') +
      funnelRow('Cart clicks',   d.cart_clicks,   d.cart_click_rate_pct,   'rgba(16,185,129,0.65)') +
      funnelRow('Option clicks', d.option_clicks, d.option_click_rate_pct, 'rgba(16,185,129,0.5)');

    tbody.innerHTML = d.top_purchase_events.map(e => `
      <tr>
        <td>${e.event_title}</td>
        <td style="color:var(--teal)">${e.cart_clicks}</td>
        <td style="color:var(--teal)">${e.option_clicks}</td>
      </tr>`).join('');

  } catch (e) {
    showError(wrap, e.message);
  }
}

// ── Section ⑥: Recent Sessions ───────────────────────────────────────────────
async function loadRecentSessions(limit = 10) {
  const tbody = document.getElementById('sessions-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="skeleton" style="height:60px"></td></tr>';
  try {
    const d = await apiFetch('/api/analytics/sessions/recent', { limit });

    tbody.innerHTML = d.sessions.map(s => {
      const isBounce = s.is_bounce;
      const rowClass = isBounce ? 'bounce-row' : '';
      const dur = fmtDuration(s.duration_s) + (isBounce ? ' <span style="color:var(--red);font-size:0.6rem">(bounce)</span>' : '');
      const flag = s.country_code ? countryFlag(s.country_code) : '';
      return `<tr class="${rowClass} session-row" data-session-id="${escHtml(s.session_id)}">
        <td>${s.ip || '—'}</td>
        <td>${flag} ${s.country_code || '—'}</td>
        <td style="color:var(--muted);font-size:0.75rem">${s.city || '—'}</td>
        <td style="color:var(--muted);font-size:0.65rem">${s.org || '—'}</td>
        <td>${relativeTime(s.started_at)}</td>
        <td>${dur}</td>
        <td style="color:var(--muted)">${fmtEventSummary(s.event_summary)}</td>
      </tr>`;
    }).join('');

  } catch (e) {
    showError(tbody, e.message);
  }
}

// Country code → flag emoji (Regional Indicator A = U+1F1E6)
function countryFlag(code) {
  return code.toUpperCase().replace(/./g, c =>
    String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))
  );
}

function initSessionsSection() {
  document.getElementById('load-more-btn').addEventListener('click', () => {
    loadRecentSessions(50);
  });

  document.getElementById('sessions-tbody').addEventListener('click', e => {
    const row = e.target.closest('.session-row');
    if (row) openSessionModal(row.dataset.sessionId);
  });
}

// ── Auto-refresh scheduler ────────────────────────────────────────────────────
// Group A (5 min):  traffic, behavior, recent sessions  — session-level metrics
// Group B (15 min): geo, timeline, funnel               — slow-changing aggregates
const REFRESH_A = 5 * 60 * 1000;
const REFRESH_B = 15 * 60 * 1000;
const REFRESH_C = 60 * 60 * 1000;  // content catalog — 1 hour

let _timers = [];

function _clearTimers() {
  _timers.forEach(clearInterval);
  _timers = [];
}

function startAutoRefresh() {
  _clearTimers();
  _timers.push(setInterval(() => loadTraffic(),         REFRESH_A));
  _timers.push(setInterval(() => loadBehavior(),        REFRESH_A));
  _timers.push(setInterval(() => loadRecentSessions(),  REFRESH_A));
  _timers.push(setInterval(() => loadGeo(),             REFRESH_B));
  _timers.push(setInterval(() => loadTimeline(),        REFRESH_B));
  _timers.push(setInterval(() => loadFunnel(),          REFRESH_B));
  _timers.push(setInterval(() => loadContentStats(),    REFRESH_C));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _clearTimers();
  } else {
    // refreshAll already calls startAutoRefresh internally
    refreshAll();
  }
});

// ── Chart zoom modal ──────────────────────────────────────────────────────────
let _modalChart = null;

function closeModal() {
  document.getElementById('chart-modal').classList.remove('open');
  if (_modalChart) { _modalChart.destroy(); _modalChart = null; }
}

function handleModalBackdropClick(e) {
  if (e.target === document.getElementById('chart-modal')) closeModal();
}

function closeSessionModal() {
  document.getElementById('session-modal').classList.remove('open');
}

function handleSessionModalBackdropClick(e) {
  if (e.target === document.getElementById('session-modal')) closeSessionModal();
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtEventData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '—';
  return Object.entries(data)
    .filter(([k]) => k !== 'event_id')
    .map(([k, v]) => `${escHtml(k)}: ${escHtml(v)}`)
    .join(' · ') || '—';
}

async function openSessionModal(sessionId) {
  const modal   = document.getElementById('session-modal');
  const title   = document.getElementById('session-modal-title');
  const meta    = document.getElementById('session-modal-meta');
  const summary = document.getElementById('session-modal-summary');
  const events  = document.getElementById('session-modal-events');

  // Reset + open immediately
  title.textContent   = sessionId;
  meta.innerHTML      = '';
  summary.innerHTML   = '';
  events.innerHTML    = '<div class="skeleton skeleton-block"></div>';
  modal.classList.add('open');

  try {
    const url = `${API_BASE}/api/analytics/sessions/${sessionId}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    // ── Metadata strip ────────────────────────────────────────────────────────
    const flag       = d.country_code ? countryFlag(d.country_code) : '';
    const geoLabel   = [d.country_name, d.city].filter(Boolean).map(escHtml).join(' / ');
    const bounceBadge = d.is_bounce
      ? '<span class="session-bounce-badge">BOUNCE</span>'
      : '';
    meta.innerHTML = `
      ${escHtml(d.ip) || '—'} &nbsp;·&nbsp;
      ${flag} ${geoLabel || '—'} &nbsp;·&nbsp;
      ${escHtml(d.org) || '—'} &nbsp;·&nbsp;
      Started: ${relativeTime(d.started_at)} &nbsp;·&nbsp;
      Duration: ${fmtDuration(d.duration_s)}
      ${bounceBadge}`;

    // ── Summary KPI row ───────────────────────────────────────────────────────
    const s = d.summary ?? {};
    summary.innerHTML =
      kpiCard('Events',        escHtml(s.total_events  ?? '—'), '') +
      kpiCard('Page Views',    escHtml(s.page_views    ?? '—'), '') +
      kpiCard('Entry Views',   escHtml(s.entry_views   ?? '—'), '') +
      kpiCard('Searches',      escHtml(s.searches      ?? '—'), '') +
      kpiCard('Topic Filters', escHtml(s.topic_filters ?? '—'), '');

    // ── Event log table ───────────────────────────────────────────────────────
    const startMs = new Date(d.started_at).getTime();
    const rows = (d.events ?? []).map(ev => {
      const offsetS = Math.max(0, Math.round((new Date(ev.ts).getTime() - startMs) / 1000));
      const offsetStr = '+' + fmtDuration(offsetS);
      return `<tr>
        <td style="font-family:monospace;white-space:nowrap">${offsetStr}</td>
        <td>${escHtml(ev.type)}</td>
        <td style="color:var(--muted)">${fmtEventData(ev.data)}</td>
      </tr>`;
    }).join('');

    events.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Time</th><th>Type</th><th>Data</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

  } catch (err) {
    showError(events, err.message);
    summary.innerHTML = '';
    meta.innerHTML = '';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeSessionModal();
    closeEntryModal();
  }
});

// ── Fill missing dates with 0 ─────────────────────────────────────────────────
function fillDates(perDay) {
  if (!perDay.length) return perDay;
  const today = new Date().toISOString().slice(0, 10);
  let from, to;
  if (_currentRange.type !== 'all' && _currentRange.from) {
    from = _currentRange.from;
    to   = _currentRange.to;
  } else {
    from = perDay[0].date;
    to   = perDay[perDay.length - 1].date;
  }
  if (to < today) to = today;
  const map = Object.fromEntries(perDay.map(r => [r.date, r.count]));
  const result = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to   + 'T00:00:00Z');
  while (cur <= end) {
    const d = cur.toISOString().slice(0, 10);
    result.push({ date: d, count: map[d] ?? 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

// ── Content heatmap builder ───────────────────────────────────────────────────
function buildTopicHeatmapHtml(pairs, topN = null) {
  if (!pairs || !pairs.length) {
    return '<p style="font-size:0.7rem;color:var(--faint)">No data</p>';
  }

  // Rank topics by total co-occurrence weight
  const totals = {};
  pairs.forEach(p => {
    totals[p.topic_a] = (totals[p.topic_a] || 0) + p.count;
    totals[p.topic_b] = (totals[p.topic_b] || 0) + p.count;
  });
  let topics = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  if (topN !== null) topics = topics.slice(0, topN);

  // Pair lookup (symmetric)
  const pairMap = {};
  pairs.forEach(p => {
    pairMap[`${p.topic_a}|${p.topic_b}`] = p.count;
    pairMap[`${p.topic_b}|${p.topic_a}`] = p.count;
  });

  const maxCount = Math.max(...pairs.map(p => p.count), 1);
  const compact  = topN !== null;
  const cell     = compact ? 14 : 20;
  const maxLen   = compact ? 7  : 10;
  const lblW     = compact ? 55 : 80;

  const abbr = t => escHtml(t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t);

  let html = `<div style="display:grid;grid-template-columns:${lblW}px repeat(${topics.length},${cell}px);gap:2px;font-size:0.5rem;overflow-x:auto">`;

  // Column headers (vertical text)
  html += '<div></div>';
  topics.forEach(t => {
    html += `<div style="color:var(--faint);writing-mode:vertical-rl;white-space:nowrap;overflow:hidden;max-height:${lblW}px;padding:2px 0" title="${escHtml(t)}">${abbr(t)}</div>`;
  });

  // Rows
  topics.forEach(row => {
    html += `<div style="color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;align-self:center;padding:2px 0" title="${escHtml(row)}">${abbr(row)}</div>`;
    topics.forEach(col => {
      if (row === col) {
        html += `<div style="background:rgba(255,255,255,0.03);border-radius:2px;height:${cell}px"></div>`;
      } else {
        const n   = pairMap[`${row}|${col}`] || 0;
        const bg  = n > 0
          ? `rgba(16,185,129,${(0.08 + (n / maxCount) * 0.85).toFixed(2)})`
          : 'rgba(255,255,255,0.02)';
        html += `<div style="background:${bg};border-radius:2px;height:${cell}px;cursor:default" title="${escHtml(row)} + ${escHtml(col)}: ${n}"></div>`;
      }
    });
  });

  html += '</div>';
  return html;
}

function renderTemporalChart() {
  if (!_contentStatsRaw) return;
  const d = _contentStatsRaw;
  const rows     = _contentDecadeView ? d.by_group_per_decade : d.by_group_per_year;
  const labelKey = _contentDecadeView ? 'decade' : 'year';

  makeChart('chart-content-temporal', {
    type: 'bar',
    data: {
      labels: rows.map(r => r[labelKey]),
      datasets: [
        { label: 'Research',    data: rows.map(r => r.research),    backgroundColor: 'rgba(99,102,241,0.7)',  stack: 'a' },
        { label: 'Industry',    data: rows.map(r => r.industry),    backgroundColor: 'rgba(245,158,11,0.7)',  stack: 'a' },
        { label: 'Pop culture', data: rows.map(r => r.pop_culture), backgroundColor: 'rgba(236,72,153,0.7)', stack: 'a' },
      ],
    },
    options: {
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 } },
      },
      scales: {
        x: { ticks: { color: '#475569', maxTicksLimit: 12 }, stacked: true },
        y: { ticks: { color: '#475569' }, stacked: true },
      },
    },
  });
  _charts['chart-content-temporal']._raw = d;

  const note = document.getElementById('content-gap-note');
  if (note) note.textContent = d.gap_years?.length
    ? `${d.gap_years.length.toLocaleString()} years with no entries`
    : '';
}

function setContentView(decadeView) {
  _contentDecadeView = decadeView;
  document.getElementById('content-decade-btn').classList.toggle('active', decadeView);
  document.getElementById('content-year-btn').classList.toggle('active', !decadeView);
  renderTemporalChart();
}

// ── Section ⑦: Content Catalog ───────────────────────────────────────────────
async function loadContentStats() {
  const totalEl = document.getElementById('content-total-count');
  if (totalEl) totalEl.textContent = '…';

  try {
    // Intentionally not using apiFetch/buildUrl — this endpoint is date-range-independent
    const res = await fetch(API_BASE + '/api/content/stats', {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    _contentStatsRaw = d;

    // Header count
    if (totalEl) totalEl.textContent = `— ${d.total.toLocaleString()} entries`;

    // ── By group doughnut ─────────────────────────────────────────────────────
    makeChart('chart-content-by-group', {
      type: 'doughnut',
      data: {
        labels: d.by_group.map(g => g.group),
        datasets: [{
          data: d.by_group.map(g => g.count),
          backgroundColor: ['#6366f1', '#f59e0b', '#ec4899'],
        }],
      },
      options: {
        cutout: '50%',
        plugins: {
          legend: {
            display: true, position: 'bottom',
            labels: { color: '#94a3b8', font: { size: 9 }, boxWidth: 10 },
          },
          centerText: { totalSessions: d.total, label: 'entries' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const pct = Math.round(ctx.parsed / d.total * 100);
                return ` ${ctx.parsed.toLocaleString()} (${pct}%)`;
              },
            },
          },
        },
      },
    });
    _charts['chart-content-by-group']._raw = d;

    // ── By topic bar (top 10) ─────────────────────────────────────────────────
    const topTopics = d.by_topic.slice(0, 10);
    makeChart('chart-content-by-topic', {
      type: 'bar',
      data: {
        labels: topTopics.map(t => t.topic),
        datasets: [{
          data: topTopics.map(t => t.count),
          backgroundColor: 'rgba(99,102,241,0.6)',
          indexAxis: 'y',
        }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569' } },
          y: { ticks: { color: '#94a3b8' } },
        },
      },
    });
    _charts['chart-content-by-topic']._raw = d;

    // ── Temporal stacked bar ──────────────────────────────────────────────────
    renderTemporalChart();

    // ── Topic heatmap (top 8 topics in compact view) ──────────────────────────
    const heatmapEl = document.getElementById('content-heatmap-grid');
    if (heatmapEl) heatmapEl.innerHTML = buildTopicHeatmapHtml(d.topic_pairs, 8);

    // ── Missing sources ───────────────────────────────────────────────────────
    const missingEl = document.getElementById('content-missing-count');
    if (missingEl) missingEl.textContent = d.research_without_source.count.toLocaleString();

  } catch (e) {
    _contentStatsRaw = null;
    const totalEl2 = document.getElementById('content-total-count');
    if (totalEl2) totalEl2.textContent = '';
    showError(document.getElementById('s-content'), e.message);
  }
}

// ── Entry drilldown modal ─────────────────────────────────────────────────────
function closeEntryModal() {
  document.getElementById('entry-modal').classList.remove('open');
  if (_entryModalChart) { _entryModalChart.destroy(); _entryModalChart = null; }
}

function handleEntryModalBackdropClick(e) {
  if (e.target === document.getElementById('entry-modal')) closeEntryModal();
}

function resolveSlug(input) {
  const lower = input.trim().toLowerCase();
  const match = _timelineTopEvents.find(e => e.event_title.toLowerCase() === lower);
  return match ? match.slug : input.trim();
}

async function fetchAndRenderEntry(slug) {
  const statusEl  = document.getElementById('entry-modal-status');
  const chartWrap = document.getElementById('entry-modal-chart-wrap');
  const tableWrap = document.getElementById('entry-modal-table-wrap');

  statusEl.textContent = 'Loading…';
  chartWrap.style.display = 'none';
  tableWrap.innerHTML = '';

  try {
    const d = await apiFetch(`/api/analytics/timeline/entries/${encodeURIComponent(slug)}`);
    const perDay = fillDates(d.entry_views_per_day ?? d.views_per_day ?? []);

    document.getElementById('entry-modal-title').textContent = d.entry_title || slug;
    statusEl.textContent = '';

    if (_entryModalChart) { _entryModalChart.destroy(); _entryModalChart = null; }
    chartWrap.innerHTML = '<canvas id="entry-modal-chart"></canvas>';
    chartWrap.style.display = 'block';
    _entryModalChart = new Chart(document.getElementById('entry-modal-chart'), {
      type: 'line',
      data: {
        labels: perDay.map(r => r.date),
        datasets: [{
          data: perDay.map(r => r.count),
          borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)',
          tension: 0.3, fill: true, pointRadius: 3,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#475569' } } },
      },
    });

    const rows = perDay.map(r => `<tr><td>${r.date}</td><td>${r.count}</td></tr>`).join('');
    tableWrap.innerHTML = `
      <div style="font-size:0.6rem;color:var(--faint);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem">Raw data</div>
      <table class="data-table"><thead><tr><th>Date</th><th>Views</th></tr></thead><tbody>${rows}</tbody></table>`;

  } catch (err) {
    statusEl.textContent = '';
    tableWrap.innerHTML = `<p class="section-error">⚠ ${escHtml(err.message)}</p>`;
  }
}

function handleEntrySearch() {
  const val = document.getElementById('entry-search-input').value;
  if (!val.trim()) return;
  fetchAndRenderEntry(resolveSlug(val));
}

function openEntryModal(slug, title) {
  const modal     = document.getElementById('entry-modal');
  const input     = document.getElementById('entry-search-input');
  const statusEl  = document.getElementById('entry-modal-status');
  const chartWrap = document.getElementById('entry-modal-chart-wrap');
  const tableWrap = document.getElementById('entry-modal-table-wrap');

  chartWrap.style.display = 'none';
  chartWrap.innerHTML = '';
  tableWrap.innerHTML = '';
  statusEl.textContent = '';

  if (slug) {
    document.getElementById('entry-modal-title').textContent = title || slug;
    input.value = slug;
    modal.classList.add('open');
    fetchAndRenderEntry(slug);
  } else {
    document.getElementById('entry-modal-title').textContent = 'Entry views over time';
    input.value = '';
    modal.classList.add('open');
    setTimeout(() => input.focus(), 50);
  }
}

const MODAL_DEFS = {
  viewsOverTime: {
    title: 'Page views over time',
    subtitle: 'Full date range',
    buildChart: (raw) => ({
      type: 'line',
      data: {
        labels: raw.views_per_day.map(r => r.date),
        datasets: [{ data: raw.views_per_day.map(r => r.count), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', tension: 0.3, fill: true, pointRadius: 3 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#475569' } } } },
    }),
    buildTable: (raw) => {
      const rows = raw.views_per_day.map(r => `<tr><td>${r.date}</td><td>${r.count}</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Date</th><th>Views</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  viewsByRoute: {
    title: 'Views by route',
    subtitle: 'All routes in selected period',
    buildChart: (raw) => ({
      type: 'bar',
      data: {
        labels: raw.views_by_route.map(r => r.route),
        datasets: [{ data: raw.views_by_route.map(r => r.count), backgroundColor: 'rgba(99,102,241,0.65)', indexAxis: 'y' }],
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#94a3b8' } } } },
    }),
    buildTable: (raw) => {
      const rows = raw.views_by_route.map(r => `<tr><td>${r.route}</td><td>${r.count}</td><td>${r.pct}%</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Route</th><th>Views</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  durationDist: {
    title: 'Session duration distribution',
    subtitle: 'Number of sessions per duration bucket',
    buildChart: (raw) => ({
      type: 'bar',
      data: { labels: raw.duration_buckets.map(b => b.label), datasets: [{ data: raw.duration_buckets.map(b => b.count), backgroundColor: 'rgba(168,85,247,0.65)' }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#475569' }, title: { display: true, text: 'Duration', color: '#64748b', font: { size: 10 } } }, y: { ticks: { color: '#475569' }, title: { display: true, text: 'Sessions', color: '#64748b', font: { size: 10 } } } } },
    }),
    buildTable: (raw) => {
      const total = raw.duration_buckets.reduce((s, b) => s + b.count, 0) || 1;
      const rows = raw.duration_buckets.map(b => `<tr><td>${b.label}</td><td>${b.count}</td><td>${Math.round(b.count/total*100)}%</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Duration</th><th>Sessions</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  eventsPerSession: {
    title: 'Events per session',
    subtitle: 'Distribution of event depth across sessions',
    buildChart: (raw) => ({
      type: 'bar',
      data: { labels: raw.events_per_session_buckets.map(b => b.label), datasets: [{ data: raw.events_per_session_buckets.map(b => b.count), backgroundColor: 'rgba(168,85,247,0.65)' }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#475569' }, title: { display: true, text: 'Events', color: '#64748b', font: { size: 10 } } }, y: { ticks: { color: '#475569' }, title: { display: true, text: 'Sessions', color: '#64748b', font: { size: 10 } } } } },
    }),
    buildTable: (raw) => {
      const rows = raw.events_per_session_buckets.map(b => `<tr><td>${b.label}</td><td>${b.count}</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Events</th><th>Sessions</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  geoDoughnut: {
    title: 'Visitors by country / city',
    subtitle: 'Outer ring = country · Inner ring = city',
    buildChart: (raw) => {
      const outerData   = raw.countries.map(c => c.sessions);
      const outerColors = raw.countries.map((_, i) => GEO_COLORS[i % GEO_COLORS.length]);
      const outerLabels = raw.countries.map(c => `${c.name} (${c.code})`);
      const innerData = [], innerColors = [], innerLabels = [], innerCountryLabels = [];
      raw.countries.forEach((c, i) => {
        c.cities.forEach(city => {
          innerData.push(city.sessions);
          innerColors.push(GEO_COLORS_LIGHT[i % GEO_COLORS_LIGHT.length]);
          innerLabels.push(`${city.name} (${c.code})`);
          innerCountryLabels.push(`${c.name} (${c.code})`);
        });
      });
      return {
        type: 'doughnut',
        data: { datasets: [{ data: outerData, backgroundColor: outerColors }, { data: innerData, backgroundColor: innerColors }] },
        options: {
          cutout: '40%',
          plugins: {
            legend: { display: false },
            centerText: { totalSessions: raw.total_sessions },
            tooltip: {
              callbacks: {
                title: items => {
                  const item = items[0];
                  return item.datasetIndex === 0
                    ? outerLabels[item.dataIndex]
                    : innerCountryLabels[item.dataIndex];
                },
                label: ctx => {
                  const lbl = ctx.datasetIndex === 0 ? outerLabels[ctx.dataIndex] : innerLabels[ctx.dataIndex];
                  return ` ${lbl}: ${ctx.parsed}`;
                },
              },
            },
          },
        },
      };
    },
    buildTable: (raw) => {
      const rows = raw.countries.flatMap(c =>
        c.cities.map(city => `<tr><td>${c.name}</td><td>${city.name}</td><td>${city.sessions}</td></tr>`)
      ).join('');
      return `<table class="data-table"><thead><tr><th>Country</th><th>City</th><th>Sessions</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  heatmap: {
    title: 'Sessions by hour of day (UTC)',
    subtitle: 'All 24 hours shown',
    buildChart: () => null,
    buildTable: (raw) => {
      const rows = raw.hourly_sessions.map(h => `<tr><td>${h.hour}:00</td><td>${h.count}</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Hour (UTC)</th><th>Sessions</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  topEvents: {
    title: 'Most-viewed timeline events',
    subtitle: 'Top 10 events in selected period · % of total event views',
    buildChart: (raw) => ({
      type: 'bar',
      data: { labels: raw.top_events.map(e => e.event_title), datasets: [{ data: raw.top_events.map(e => e.views), backgroundColor: 'rgba(245,158,11,0.65)' }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#475569', maxRotation: 30 } }, y: { ticks: { color: '#475569' } } } },
    }),
    buildTable: (raw) => {
      const total = raw.total_event_views || 1;
      const rows = raw.top_events.map(e => `<tr><td>${e.event_title}</td><td>${e.views}</td><td>${Math.round(e.views/total*100)}%</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Event</th><th>Views</th><th>% of total</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  topicFilters: {
    title: 'Topic filter popularity',
    subtitle: 'Individual topic activations in selected period',
    buildChart: (raw) => ({
      type: 'bar',
      data: { labels: raw.topic_filter_popularity.map(t => t.topic), datasets: [{ data: raw.topic_filter_popularity.map(t => t.uses), backgroundColor: 'rgba(245,158,11,0.55)', indexAxis: 'y' }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#94a3b8' } } } },
    }),
    buildTable: (raw) => {
      const rows = raw.topic_filter_popularity.map(t => `<tr><td>${t.topic}</td><td>${t.uses}</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Topic</th><th>Uses</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  entryViewsOverTime: {
    title: 'Event views over time',
    subtitle: 'Timeline event views per day in selected period',
    buildChart: (raw) => ({
      type: 'line',
      data: {
        labels: raw.entry_views_per_day.map(r => r.date),
        datasets: [{ data: raw.entry_views_per_day.map(r => r.count), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.3, fill: true, pointRadius: 3 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#475569' } } } },
    }),
    buildTable: (raw) => {
      const rows = raw.entry_views_per_day.map(r => `<tr><td>${r.date}</td><td>${r.count}</td></tr>`).join('');
      return `<table class="data-table"><thead><tr><th>Date</th><th>Views</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
  funnel: {
    title: 'Conversion funnel',
    subtitle: 'All percentages relative to event views (top of funnel)',
    buildChart: () => null,
    buildTable: (raw) => `
      <table class="data-table">
        <thead><tr><th>Step</th><th>Count</th><th>% of views</th></tr></thead>
        <tbody>
          <tr><td>Event views</td><td>${raw.event_views}</td><td>100%</td></tr>
          <tr><td>Cart clicks</td><td>${raw.cart_clicks}</td><td>${raw.cart_click_rate_pct}%</td></tr>
          <tr><td>Option clicks</td><td>${raw.option_clicks}</td><td>${raw.option_click_rate_pct}%</td></tr>
        </tbody>
      </table>`,
  },

  contentByGroup: {
    title: 'Content by group',
    subtitle: 'Distribution of all entries across the three content groups',
    buildChart: (raw) => ({
      type: 'doughnut',
      data: {
        labels: raw.by_group.map(g => g.group),
        datasets: [{
          data: raw.by_group.map(g => g.count),
          backgroundColor: ['#6366f1', '#f59e0b', '#ec4899'],
        }],
      },
      options: {
        cutout: '50%',
        plugins: {
          legend: { display: true, position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } },
          centerText: { totalSessions: raw.total, label: 'entries' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const pct = Math.round(ctx.parsed / raw.total * 100);
                return ` ${ctx.parsed.toLocaleString()} (${pct}%)`;
              },
            },
          },
        },
      },
    }),
    buildTable: (raw) => {
      const rows = raw.by_group.map(g =>
        `<tr><td>${escHtml(g.group)}</td><td>${g.count}</td><td>${Math.round(g.count / raw.total * 100)}%</td></tr>`
      ).join('');
      return `<table class="data-table"><thead><tr><th>Group</th><th>Count</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },

  contentByTopic: {
    title: 'Content by topic',
    subtitle: 'All topics ranked by entry count',
    buildChart: (raw) => ({
      type: 'bar',
      data: {
        labels: raw.by_topic.map(t => t.topic),
        datasets: [{
          data: raw.by_topic.map(t => t.count),
          backgroundColor: 'rgba(99,102,241,0.6)',
          indexAxis: 'y',
        }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569' } },
          y: { ticks: { color: '#94a3b8', font: { size: 10 } } },
        },
      },
    }),
    buildTable: (raw) => {
      const rows = raw.by_topic.map(t =>
        `<tr><td>${escHtml(t.topic)}</td><td>${t.count}</td></tr>`
      ).join('');
      return `<table class="data-table"><thead><tr><th>Topic</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },

  contentTemporal: {
    title: 'Entries over time',
    subtitle: () => `Stacked by group — ${_contentDecadeView ? 'decade' : 'year'} view`,
    buildChart: (raw) => {
      const rows     = _contentDecadeView ? raw.by_group_per_decade : raw.by_group_per_year;
      const labelKey = _contentDecadeView ? 'decade' : 'year';
      return {
        type: 'bar',
        data: {
          labels: rows.map(r => r[labelKey]),
          datasets: [
            { label: 'Research',    data: rows.map(r => r.research),    backgroundColor: 'rgba(99,102,241,0.7)',  stack: 'a' },
            { label: 'Industry',    data: rows.map(r => r.industry),    backgroundColor: 'rgba(245,158,11,0.7)',  stack: 'a' },
            { label: 'Pop culture', data: rows.map(r => r.pop_culture), backgroundColor: 'rgba(236,72,153,0.7)', stack: 'a' },
          ],
        },
        options: {
          plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } },
          scales: {
            x: { ticks: { color: '#475569', maxTicksLimit: 15 }, stacked: true },
            y: { ticks: { color: '#475569' }, stacked: true },
          },
        },
      };
    },
    buildTable: (raw) => {
      const rows     = _contentDecadeView ? raw.by_group_per_decade : raw.by_group_per_year;
      const labelKey = _contentDecadeView ? 'decade' : 'year';
      const tableRows = rows.map(r =>
        `<tr><td>${escHtml(String(r[labelKey]))}</td><td>${r.research}</td><td>${r.industry}</td><td>${r.pop_culture}</td></tr>`
      ).join('');
      return `<table class="data-table"><thead><tr><th>${_contentDecadeView ? 'Decade' : 'Year'}</th><th>Research</th><th>Industry</th><th>Pop culture</th></tr></thead><tbody>${tableRows}</tbody></table>`;
    },
  },

  contentTopicHeatmap: {
    title: 'Topic co-occurrence',
    subtitle: 'How often two topics appear together on the same entry',
    buildChart: () => null,
    buildTable: (raw) => {
      const grid = buildTopicHeatmapHtml(raw.topic_pairs, null);
      const tableRows = raw.topic_pairs.map(p =>
        `<tr><td>${escHtml(p.topic_a)}</td><td>${escHtml(p.topic_b)}</td><td>${p.count}</td></tr>`
      ).join('');
      const table = `<table class="data-table"><thead><tr><th>Topic A</th><th>Topic B</th><th>Count</th></tr></thead><tbody>${tableRows}</tbody></table>`;
      return `<div style="margin-bottom:1.5rem">${grid}</div>${table}`;
    },
  },

  contentMissingSource: {
    title: 'Research entries without source',
    subtitle: 'Research-group entries that are missing a source URL or citation',
    buildChart: () => null,
    buildTable: (raw) => {
      const rows = raw.research_without_source.entries.map(e =>
        `<tr><td>${e.id}</td><td>${escHtml(e.headline)}</td></tr>`
      ).join('');
      return `<table class="data-table"><thead><tr><th>ID</th><th>Headline</th></tr></thead><tbody>${rows}</tbody></table>`;
    },
  },
};

function openModal(key) {
  const def = MODAL_DEFS[key];
  if (!def) return;

  const chartId = {
    viewsOverTime:    'chart-views-over-time',
    viewsByRoute:     'chart-views-by-route',
    durationDist:     'chart-duration-dist',
    eventsPerSession: 'chart-events-per-session',
    geoDoughnut:      'chart-geo-doughnut',
    heatmap:          'chart-geo-doughnut',
    topEvents:           'chart-top-events',
    topicFilters:        'chart-topic-filters',
    entryViewsOverTime:  'chart-entry-views-over-time',
    funnel:              null,
    contentByGroup:         'chart-content-by-group',
    contentByTopic:         'chart-content-by-topic',
    contentTemporal:        'chart-content-temporal',
    contentTopicHeatmap:    '_contentStats',
    contentMissingSource:   '_contentStats',
  }[key];

  const raw = chartId === '_contentStats' ? _contentStatsRaw
            : chartId                     ? _charts[chartId]?._raw
            :                               _funnelRaw;
  if (!raw) return;

  document.getElementById('modal-title').textContent    = def.title;
  document.getElementById('modal-subtitle').textContent =
    typeof def.subtitle === 'function' ? def.subtitle() : def.subtitle;
  document.getElementById('modal-table-wrap').innerHTML = def.buildTable(raw);

  const chartWrap = document.getElementById('modal-chart-wrap');
  if (_modalChart) { _modalChart.destroy(); _modalChart = null; }

  const cfg = def.buildChart(raw);
  if (cfg) {
    chartWrap.style.display = 'block';
    chartWrap.innerHTML = '<canvas id="modal-chart"></canvas>';
    _modalChart = new Chart(document.getElementById('modal-chart'), cfg);
  } else {
    chartWrap.style.display = 'none';
  }

  document.getElementById('chart-modal').classList.add('open');
}

// ── refreshAll + init ─────────────────────────────────────────────────────────
async function refreshAll() {
  _lastRefresh = Date.now();
  document.getElementById('last-updated').textContent = 'Updated just now';
  // Reset intervals so they don't fire shortly after a manual refresh
  startAutoRefresh();
  await Promise.all([
    loadTraffic(),
    loadBehavior(),
    loadGeo(),
    loadTimeline(),
    loadFunnel(),
    loadRecentSessions(),
    loadContentStats(),
  ]);
}

document.addEventListener('DOMContentLoaded', () => {
  initDateRange();
  startUpdatedTicker();
  initSessionsSection();
  refreshAll();
});
