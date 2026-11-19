(function (factory) {
    const shell = factory();
    if (typeof module === 'object' && module.exports) module.exports = shell;
    else shell.mount(document);
})(function () {
    const pages = [
        ['home', 'Home', '/'], ['work', 'Work', '/projects.html'],
        ['workshops', 'Workshops', '/workshops'], ['about', 'About', '/blogs/blog.html'],
        ['cv', 'CV', '/cv.html'],
    ];

    function header(active = '') {
        return `<nav class="site-header" aria-label="Main navigation">
    <a href="/" class="nav-name">Tamara Martinović, PhD</a>
    <div class="nav-links">${pages.map(([key, label, href]) => `
        <a href="${href}" class="nav-link${key === active ? ' active' : ''}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    </div>
    <div class="nav-right" aria-hidden="true"></div>
</nav>`;
    }

    function footer() {
        return `<footer class="site-footer" id="site-footer" aria-label="Site footer">
    <div class="site-footer-inner">
        <div class="site-footer-main">
            <div class="site-footer-brand">
                <a class="site-footer-name" href="/">Tamara Martinović<span>, PhD</span></a>
                <p>AI engineering, software development and practical AI workshops.</p>
                <a class="site-footer-email" href="mailto:tamara@nosastra.co">tamara@nosastra.co</a>
            </div>
            <section class="site-footer-column" aria-labelledby="footer-explore">
                <h2 id="footer-explore">Explore</h2>
                <ul>${pages.map(([, label, href]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>
            </section>
            <section class="site-footer-column" aria-labelledby="footer-connect">
                <h2 id="footer-connect">Connect</h2>
                <ul>
                    <li><a href="https://www.linkedin.com/in/tamaracodes/" target="_blank" rel="noopener">LinkedIn</a></li>
                    <li><a href="https://x.com/codewithtamara" target="_blank" rel="noopener">X / Twitter</a></li>
                    <li><a href="https://github.com/Tamara-Codes" target="_blank" rel="noopener">GitHub</a></li>
                    <li><a href="https://nosastra.co" target="_blank" rel="noopener">Nos Astra</a></li>
                </ul>
            </section>
        </div>
        <div class="site-footer-bottom">
            <p>© 2025 Tamara Martinović</p>
            <div class="site-footer-meta"><span>Based in Croatia</span><div class="visitor-counter" aria-live="polite"><span class="visitor-counter-label">visitors</span><output class="visitor-counter-number" id="visitorCount" aria-label="Visitor count">••••••</output></div></div>
        </div>
    </div>
</footer>`;
    }

    // Pages contain generated HTML, so navigation is stable even before JS loads.
    // This also supports older pages that have not been regenerated yet.
    function mount(doc) {
        if (!doc.querySelector('.site-header')) {
            const nav = doc.querySelector('nav');
            if (nav) nav.outerHTML = header();
        }
        if (!doc.querySelector('.site-footer')) {
            const existing = doc.querySelector('footer');
            if (existing) existing.outerHTML = footer();
            else doc.body.insertAdjacentHTML('beforeend', footer());
        }
    }
    return { header, footer, mount };
});
