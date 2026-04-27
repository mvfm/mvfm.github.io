/**
 * Global UI Behaviors
 * Handles sticky header, global transitions, and other UI logic.
 */
export function initUI() {
    const app = document.querySelector('.app');
    const topBar = document.getElementById('topBar');

    function syncTopbarHeight() {
        document.documentElement.style.setProperty('--topbar-height', topBar.offsetHeight + 'px');
    }

    // After the header shrinks, record the exact topBar height for sticky positioning
    topBar.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'height' && app.classList.contains('scrolled')) {
            syncTopbarHeight();
        }
    });

    window.addEventListener('resize', () => {
        if (app.classList.contains('scrolled')) syncTopbarHeight();
    }, { passive: true });

    // Sticky / Shrunken header on scroll
    window.addEventListener('scroll', () => {
        if (window.scrollY > 40) {
            app.classList.add('scrolled');
        } else {
            app.classList.remove('scrolled');
        }
    }, { passive: true });

    console.log("UI behaviors initialized.");
}
