/**
 * Global UI Behaviors
 * Handles sticky header, global transitions, and other UI logic.
 */
export function initUI() {
    const app = document.querySelector('.app');

    // Sticky / Shrunken header on scroll
    window.addEventListener('scroll', () => {
        if (window.scrollY > 40) {
            app.classList.add('scrolled');
        } else {
            app.classList.remove('scrolled');
        }
    });

    console.log("UI behaviors initialized.");
}
