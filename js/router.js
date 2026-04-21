import { track } from './analytics.js';

let _analyticsReady = false;

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
            if (path && this.routes[path]) {
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
        localStorage.setItem('lastRoute', route);
        if (_analyticsReady) {
            track('page_view', { route: route === 'home' ? '/' : `/${route}` });
        }
        _analyticsReady = true;

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
        this.menuButtons.forEach(btn => {
            btn.setAttribute('aria-current', btn.dataset.route === activeRoute ? 'page' : 'false');
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
