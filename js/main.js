import { GameOfLife } from './gol.js';
import { Router } from './router.js';
import { initUI } from './ui.js';

/**
 * App Configuration & Initialization
 */
const CONFIG = (() => {
    const params = new URLSearchParams(window.location.search);
    const forceRemote = params.get('api') === 'remote';
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    return {
        API_BASE_URL: (isLocal && !forceRemote)
            ? 'http://localhost:8080'
            : 'https://mvfm.pythonanywhere.com',
        MAX_RETRIES: 3,
        RETRY_DELAY_MS: 2000
    };
})();

const aiRouteOnLoad = async () => {
    const embed = document.getElementById('timeline-embed');

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            if (embed) {
                const message = attempt > 1
                    ? `Retrying (${attempt} of ${CONFIG.MAX_RETRIES})...`
                    : `Loading timeline data...`;

                embed.innerHTML = `
                    <div class="spinner-container">
                        <div class="spinner"></div>
                        <p class="loading-text">${message}</p>
                    </div>`;
            }

            if (attempt > 1) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS));
            }

            const queryUrl = new URL(`${CONFIG.API_BASE_URL}/timeline`);
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('q')) {
                queryUrl.searchParams.append('q', urlParams.get('q'));
            }

            console.log(`Attempt ${attempt}: Fetching timeline data from ${queryUrl}...`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const response = await fetch(queryUrl, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();

            // Success: Initialize TimelineJS or show empty message
            setTimeout(() => {
                if (data.events && data.events.length > 0) {
                    if (window.TL) {
                        window.timeline = new TL.Timeline('timeline-embed', data, {
                            theme_color: "#b94d97",
                            initial_zoom: 2,
                            hash_bookmark: true,
                            timenav_position: "bottom",
                            font: "default"
                        });
                    }
                } else {
                    // Handle empty results gracefully
                    if (embed) {
                        embed.innerHTML = `
                            <div class="spinner-container">
                                <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--clr-text-muted)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;">
                                    <circle cx="11" cy="11" r="8"></circle>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                    <line x1="11" y1="8" x2="11" y2="12"></line>
                                    <line x1="11" y1="14" x2="11.01" y2="14"></line>
                                </svg>
                                <p class="loading-text" style="color: var(--clr-text-muted);">No matching events found.</p>
                                <button id="empty-clear-search" class="btn-secondary" style="margin-top: 1rem;">View all events</button>
                            </div>`;

                        document.getElementById('empty-clear-search')?.addEventListener('click', () => {
                            const input = document.getElementById('search-input');
                            if (input) {
                                input.value = '';
                                const url = new URL(window.location.href);
                                url.searchParams.delete('q');
                                window.history.pushState({}, '', url);
                                aiRouteOnLoad();
                            }
                        });
                    }
                }
                // Initialize Search UI behaviors
                initTimelineSearch();
            }, 50);

            return; // Exit loop on success

        } catch (error) {
            console.error(`Attempt ${attempt} failed:`, error);

            if (attempt === CONFIG.MAX_RETRIES) {
                const isTimeout = error.name === 'AbortError';
                const errorMsg = isTimeout
                    ? `Request timed out after 60s. The AIAPI might still be starting up.`
                    : `${error.message}`;

                if (embed) {
                    embed.innerHTML = `
                        <div style="padding: 2.5rem; color: #ff6b6b; text-align: center; border: 1px dashed #ff6b6b; border-radius: 12px; margin: 1rem;">
                            <h3 style="margin-top:0">Failed to load timeline</h3>
                            <p>${errorMsg}</p>
                            <p style="font-size: 0.85rem; opacity: 0.8;">
                                URL: <code>${CONFIG.API_BASE_URL}/timeline</code><br>
                                ${error.name}: Ensure the AIAPI is reachable.
                            </p>
                            <button onclick="location.reload()" style="background: transparent; border: 1px solid #ff6b6b; color: #ff6b6b; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; margin-top: 1rem;">Retry Page</button>
                        </div>`;
                }
            }
        }
    }
};

/**
 * Initialize Timeline Search UI interactions
 */
const initTimelineSearch = () => {
    const toggle = document.getElementById('search-toggle');
    const container = document.getElementById('search-container');
    const input = document.getElementById('search-input');
    const submit = document.getElementById('search-submit');
    const cancel = document.getElementById('search-cancel');

    if (!toggle || !container || !input || !submit || !cancel) return;

    // Prevent double initialization
    if (toggle.dataset.initialized) return;
    toggle.dataset.initialized = "true";

    // Set initial value from URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('q')) {
        input.value = urlParams.get('q');
        container.classList.add('show');
        submit.disabled = !input.value.trim();
    }

    const toggleSearch = () => {
        const isShowing = container.classList.toggle('show');
        if (isShowing) input.focus();
    };

    const performSearch = () => {
        const query = input.value.trim();
        if (query) {
            const url = new URL(window.location.href);
            url.searchParams.set('q', query);
            window.history.pushState({}, '', url);
            // Re-trigger load
            aiRouteOnLoad();
        }
    };

    const clearSearch = () => {
        input.value = '';
        container.classList.remove('show');
        const url = new URL(window.location.href);
        if (url.searchParams.has('q')) {
            url.searchParams.delete('q');
            window.history.pushState({}, '', url);
            aiRouteOnLoad();
        }
    };

    toggle.addEventListener('click', toggleSearch);
    cancel.addEventListener('click', clearSearch);
    submit.addEventListener('click', performSearch);

    input.addEventListener('input', () => {
        submit.disabled = !input.value.trim();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !submit.disabled) {
            performSearch();
        } else if (e.key === 'Escape') {
            container.classList.remove('show');
        }
    });
};

const routes = {
    home: { title: 'Welcome', template: 'tpl-home' },
    contact: { title: 'Contact', template: 'tpl-contact' },
    resume: { title: 'Resume', template: 'tpl-resume' },
    ai: { title: 'AI', template: 'tpl-ai', onLoad: aiRouteOnLoad }
};

// Start application
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize UI global behaviors
    initUI();

    // 2. Initialize Game of Life engine
    new GameOfLife('golCanvas', {
        gen: 'genDigits',
        alive: 'aliveDigits',
        total: 'totalDigits',
        occ: 'occDigits'
    });

    // 3. Initialize Router
    new Router(routes);
});
