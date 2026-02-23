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
        window.addEventListener('load', () => {
            const pathSegments = window.location.pathname.split('/').filter(Boolean);
            const path = pathSegments.pop();
            const initialRoute = (path && this.routes[path]) ? path : 'home';
            this.navigate(initialRoute, false);
        });
    }

    async navigate(route, updateHistory = true) {
        const def = this.routes[route] || this.routes.home;

        // Update browser state
        document.title = `mvfm's website — ${def.title}`;
        this.updateMetaDescription(def.title);
        this.updateMenu(route);

        if (updateHistory) {
            const newPath = route === 'home' ? '/' : `/${route}`;
            // Preserve existing hash (important for TimelineJS deep-linking)
            const url = newPath + window.location.hash;
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

    updateMetaDescription(title) {
        let meta = document.querySelector('meta[name="description"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'description');
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', `mvfm's personal website - ${title}. Exploring AI, systems engineering, and complex systems.`);
    }
}
