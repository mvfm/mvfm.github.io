export const BRAND = "mvfm's website";

export const NAV_ITEMS = [
    { route: 'home',     label: 'Home' },
    { route: 'contact',  label: 'Contact' },
    { route: 'resume',   label: 'Résumé' },
    { route: 'ai',       label: 'AI' },
    { route: 'insights', label: 'Insights' },
    { route: 'findings', label: 'Findings' },
];

const TEMPLATES = {
    home: `
        <h2>AI did not arrive all at once. It accumulated.</h2>
        <p>
            A theorem here, a machine there; a promising idea abandoned, rediscovered, and renamed decades later.
            Today’s AI boom is only the latest chapter in a much longer (and much stranger) story.
        </p>
        <p>
            The <strong>AI History Timeline</strong> follows that story from the earliest work in logic and
            computation through neural networks, landmark research, AI winters, industry bets, and the products that
            brought AI into everyday life. Hundreds of dated entries connect papers, inventions, company milestones,
            and pop-culture moments in one continuous, searchable chronology.
        </p>
        <p><strong><a href="/ai">Explore the AI History Timeline</a></strong></p>

        <h2>Beyond the dates</h2>
        <p>
            A timeline can tell you what happened. <strong>Insights</strong> asks what it meant, and what we may have
            misunderstood along the way. These essays follow the people, ideas, breakthroughs, failures, and recurring
            patterns that deserve more room than a single timeline entry can give them.
        </p>
        <p><strong><a href="/insights">Read the latest Insights</a></strong></p>

        <h2>About me</h2>
        <p>
            I’m Marcus Vinicius Freitas Margarites, a systems engineer and software designer with almost 40 years
            of experience. This site brings together my professional work and an independent, ongoing attempt to make
            sense of AI’s history without flattening it into a parade of product launches.
        </p>
        <p><strong><a href="/resume">View my résumé</a></strong> · <strong><a href="/contact">Get in touch</a></strong></p>`,

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
            <p class="timeline-copyright">
                <a href="https://x.com/aihtimeline" target="_new">@aihtimeline</a>
                &copy; 2026 Marcus Vinicius Freitas Margarites. The curation, text, and compilation of this timeline are my intellectual property and may not be reproduced without attribution.
            </p>
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

    findings: `
        <div class="view-header">
            <h2>Findings</h2>
            <div class="header-actions">
                <button id="findings-map-toggle" class="btn-secondary" hidden>Map</button>
                <button id="findings-search-toggle" class="icon-button" title="Filter findings">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"
                        stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </button>
            </div>
        </div>
        <div id="findings-filter" class="search-bar">
            <div class="search-inner">
                <input type="text" id="findings-search-input" placeholder="Filter findings…" aria-label="Filter findings">
                <div class="search-actions">
                    <button id="findings-filter-clear" class="btn-secondary">Clear</button>
                </div>
            </div>
            <div id="findings-topic-filters" class="topic-filter-list"></div>
        </div>
        <div class="findings-split">
            <div class="findings-list">
                <ul id="findings-rows" class="findings-rows">
                    <li class="spinner-container"><div class="spinner"></div>
                        <p class="loading-text">Loading findings…</p></li>
                </ul>
            </div>
            <div class="findings-graph">
                <canvas id="findings-canvas"></canvas>
                <div id="findings-graph-controls" class="findings-graph-controls">
                    <button data-zoom="in" aria-label="Zoom in">+</button>
                    <button data-zoom="out" aria-label="Zoom out">−</button>
                    <button data-zoom="reset" aria-label="Reset view">⤢</button>
                </div>
                <div id="findings-graph-legend" class="findings-graph-legend"></div>
            </div>
        </div>
        <aside id="findings-detail" class="findings-detail" hidden></aside>`,
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
