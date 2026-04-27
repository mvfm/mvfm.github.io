export const BRAND = "mvfm's website";

export const NAV_ITEMS = [
    { route: 'home',     label: 'Home' },
    { route: 'contact',  label: 'Contact' },
    { route: 'resume',   label: 'Résumé' },
    { route: 'ai',       label: 'AI' },
    { route: 'insights', label: 'Insights' },
];

const TEMPLATES = {
    home: `
        <h2>Welcome</h2>
        <p>Use the menu above to switch sections.</p>`,

    contact: `
        <h2>Contact</h2>
        <ul>
            <li>Email: <a href="mailto:marcus.margarites@hotmail.com">marcus.margarites@hotmail.com</a></li>
            <li>LinkedIn: <a href="https://www.linkedin.com/in/marcusmargarites/">linkedin.com/in/marcusmargarites/</a></li>
        </ul>`,

    resume: `
        <h2>Résumé</h2>
        <div id="resume-quip"></div>
        <p>
            I am a senior software engineer and solution designer who helps organizations modernize complex enterprise
            systems. Across decades of hands-on experience, I have worked from legacy platforms to cloud-native and
            AI-enabled solutions, combining software architecture, technical leadership, systems analysis, and
            development to deliver reliable, scalable, and maintainable systems. I have supported companies in
            consulting, product, banking, retail, travel, media, and industrial environments, helping teams evolve
            critical applications, improve delivery quality, and bridge established technology with modern platforms.
        </p>
        <p><a href="/pdf/resume.pdf">Click to view my résumé</a>.</p>`,

    ai: `
        <div class="view-header">
            <h2>AI Timeline</h2>
            <div class="header-actions">
                <button id="search-toggle" class="icon-button" title="Search Timeline">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"
                        stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </button>
                <span class="bell-wrap" id="modal-bell-wrap">
                    <button id="modal-bell-btn" class="icon-button" title="What's New &amp; On This Day" disabled>
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"
                            stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                        </svg>
                    </button>
                    <span class="modal-bell-badge" id="modal-bell-badge" hidden></span>
                </span>
            </div>
        </div>
        <div id="search-container" class="search-bar">
            <div class="search-inner">
                <input type="text" id="search-input" placeholder="Search events..." aria-label="Search events">
                <div class="search-actions">
                    <button id="search-submit" class="btn-primary" disabled>Search</button>
                    <button id="search-cancel" class="btn-secondary">Clear</button>
                </div>
            </div>
            <div id="topic-filter-container" class="topic-filter-list"></div>
        </div>
        <div class="timeline-wrapper">
            <div id="timeline-embed">
                <div class="spinner-container">
                    <div class="spinner"></div>
                    <p class="loading-text">Loading timeline data...</p>
                </div>
            </div>
            <p class="timeline-copyright">&copy; 2026 Marcus Vinicius Freitas Margarites. The curation, text, and compilation of this timeline are my intellectual property and may not be reproduced without attribution.</p>
        </div>`,

    insights: `
        <div class="view-header">
            <h2>Insights</h2>
        </div>
        <div id="insights-grid" class="insights-grid">
            <div class="spinner-container">
                <div class="spinner"></div>
                <p class="loading-text">Loading articles...</p>
            </div>
        </div>`,
};

export function injectShell() {
    const brand = document.querySelector('.brand');
    if (brand) brand.textContent = BRAND;

    const menu = document.querySelector('.menu');
    if (menu) {
        menu.innerHTML = NAV_ITEMS
            .map(({ route, label }) => `<button data-route="${route}">${label}</button>`)
            .join('');
    }

    Object.entries(TEMPLATES).forEach(([name, html]) => {
        if (!document.getElementById(`tpl-${name}`)) {
            const tpl = document.createElement('template');
            tpl.id = `tpl-${name}`;
            tpl.innerHTML = html;
            document.body.appendChild(tpl);
        }
    });
}
