import { GameOfLife } from './gol.js';
import { Router } from './router.js';
import { initUI } from './ui.js';

/**
 * App Configuration & Initialization
 */
const CONFIG = {
    API_BASE_URL: 'https://mvfm.pythonanywhere.com'
};

const aiRouteOnLoad = async () => {
    const embed = document.getElementById('timeline-embed');
    try {
        console.log(`Fetching timeline data from ${CONFIG.API_BASE_URL}/timeline...`);

        // Comprehensive timeout handling (60s) for PythonAnywhere cold starts
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(`${CONFIG.API_BASE_URL}/timeline`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();

        // Initialize TimelineJS with "Pro" options for deep-linking and layout stability
        setTimeout(() => {
            if (window.TL) {
                window.timeline = new TL.Timeline('timeline-embed', data, {
                    theme_color: "#b94d97", // Fallback, but we will override this in CSS
                    initial_zoom: 2,
                    hash_bookmark: true,
                    timenav_position: "bottom",
                    font: "default"
                });
            }
        }, 50);

    } catch (error) {
        const isTimeout = error.name === 'AbortError';
        const errorMsg = isTimeout
            ? `Request timed out after 60s. The AIAPI might still be starting up.`
            : `${error.message}`;

        console.error("Failed to load timeline:", error);
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
