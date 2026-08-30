import { track } from './analytics.js';

export async function findingsRouteOnLoad() {
    const rows = document.getElementById('findings-rows');
    if (!rows) return;
    rows.innerHTML = '<p class="loading-text">Findings coming online…</p>';
    console.log('[findings] route loaded');
}
