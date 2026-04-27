import { track } from './analytics.js';

export class Router {
    constructor(routes) {
        this.routes = routes;
        this.panel = document.getElementById('contentPanel');
        this.menuButtons = document.querySelectorAll('.menu button');

        this.init();
    }

    init() {
        this.menuButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const route = btn.dataset.route;
                this.navigate(route, true);
            });
        });

        // Handle browser Back/Forward navigation
        window.addEventListener('popstate', () => {
            const pathSegments = window.location.pathname.split('/').filter(Boolean);
            const path = pathSegments.pop() || 'home';
            this.navigate(path, false);
        });

        // Initial load
        const handleInitialRoute = () => {
            const pathSegments = window.location.pathname.split('/').filter(Boolean);
            const path = pathSegments.pop();
            
            let initialRoute = 'home';
            if (window.__FEATURE_SLUG__ && this.routes['insights-article']) {
                initialRoute = 'insights-article';
            } else if (path && this.routes[path]) {
                initialRoute = path;
            } else if (!path || path === '/') {
                // If on root, try to restore from localStorage
                const savedRoute = localStorage.getItem('lastRoute');
                if (savedRoute && this.routes[savedRoute]) {
                    initialRoute = savedRoute;
                    // Update URL to match restored route without adding history entry
                    const newPath = initialRoute === 'home' ? '/' : `/${initialRoute}`;
                    window.history.replaceState({ route: initialRoute }, '', newPath + window.location.search + window.location.hash);
                }
            }
            
            this.navigate(initialRoute, false);
        };

        if (document.readyState === 'complete') {
            handleInitialRoute();
        } else {
            window.addEventListener('load', handleInitialRoute);
        }
    }

    async navigate(route, updateHistory = true) {
        const def = this.routes[route] || this.routes.home;

        // Update browser state
        document.title = def.title;
        this.updatePageMeta(def);
        this.updateMenu(route);
        if (route !== 'insights-article') localStorage.setItem('lastRoute', route);
        const trackPath = route === 'insights-article'
            ? window.location.pathname
            : (route === 'home' ? '/' : `/${route}`);
        track('page_view', { route: trackPath });

        if (updateHistory) {
            const newPath = route === 'home' ? '/' : `/${route}`;
            // Preserve existing hash and search (important for TimelineJS and search functionality)
            const url = newPath + window.location.search + window.location.hash;
            window.history.pushState({ route }, '', url);
        }

        // Start exit transition
        this.panel.classList.remove('show');

        // Layout stabilization: prevent scroll jump
        const prevHeight = this.panel.offsetHeight;
        this.panel.style.minHeight = `${prevHeight}px`;

        // Wait slightly for exit animation
        setTimeout(async () => {
            const template = document.getElementById(def.template);
            if (template) {
                this.panel.innerHTML = '';
                this.panel.appendChild(template.content.cloneNode(true));

                // Reset layout stabilization
                requestAnimationFrame(() => {
                    this.panel.style.minHeight = '';
                });

                // Trigger enter animation
                requestAnimationFrame(() => this.panel.classList.add('show'));

                // Run view hooks
                if (typeof def.onLoad === 'function') {
                    await def.onLoad();
                }
            }
        }, 120);
    }

    updateMenu(activeRoute) {
        const displayRoute = activeRoute === 'insights-article' ? 'insights' : activeRoute;
        this.menuButtons.forEach(btn => {
            btn.setAttribute('aria-current', btn.dataset.route === displayRoute ? 'page' : 'false');
        });
    }

    updatePageMeta(def) {
        const url = def.canonicalUrl || 'https://mvfm.digital/';
        this.setMeta('name', 'description', def.description);
        this.setMeta('property', 'og:title', def.title);
        this.setMeta('property', 'og:description', def.description);
        this.setMeta('property', 'og:url', url);
        this.setMeta('name', 'twitter:title', def.title);
        this.setMeta('name', 'twitter:description', def.description);
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.setAttribute('href', url);
    }

    setMeta(attrName, attrValue, content) {
        let el = document.querySelector(`meta[${attrName}="${attrValue}"]`);
        if (!el) {
            el = document.createElement('meta');
            el.setAttribute(attrName, attrValue);
            document.head.appendChild(el);
        }
        el.setAttribute('content', content);
    }
}
