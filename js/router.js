/**
 * SPA Router
 * Handles navigation, content swapping, and view hooks.
 */
export class Router {
    constructor(routes) {
        this.routes = routes;
        this.panel = document.getElementById('contentPanel');
        this.menuButtons = document.querySelectorAll('.menu button');

        this.init();
    }

    init() {
        this.menuButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const route = btn.dataset.route;
                this.navigate(route);
            });
        });

        // Initial load
        window.addEventListener('load', () => {
            const initialRoute = 'home'; // Could be derived from URL hash if needed
            this.navigate(initialRoute);
        });
    }

    async navigate(route) {
        const def = this.routes[route] || this.routes.home;

        // Update browser state
        document.title = `mvfm's website — ${def.title}`;
        this.updateMenu(route);

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
}
