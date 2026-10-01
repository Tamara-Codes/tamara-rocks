(function () {
    var existingNav = document.querySelector('nav');
    if (!existingNav) return;

    existingNav.outerHTML = `
        <nav>
            <a href="index.html" class="nav-name">Tamara Martinovic, PhD</a>
            <div class="nav-links">
                <a href="index.html" class="nav-link">Home</a>
                <a href="projects.html" class="nav-link active">Work</a>
                <a href="blogs/blog.html" class="nav-link">About</a>
                <a href="cv.html" class="nav-link">CV</a>
            </div>
            <div class="nav-right">
                <div class="visitor-counter" aria-live="polite">
                    <span class="visitor-counter-label">visitors</span>
                    <output class="visitor-counter-number" id="visitorCount" aria-label="Visitor count">••••••</output>
                </div>
            </div>
        </nav>`;

    var output = document.getElementById('visitorCount');
    if (!output) return;

    fetch('/api/visitor-count', { credentials: 'same-origin' })
        .then(function (response) {
            if (!response.ok) throw new Error('Counter unavailable');
            return response.json();
        })
        .then(function (data) {
            var visits = Number(data.visits);
            if (!Number.isFinite(visits) || visits < 0) throw new Error('Invalid count');
            output.textContent = String(Math.floor(visits)).padStart(6, '0');
            output.classList.add('is-ready');
        })
        .catch(function () {
            output.textContent = 'offline';
        });
})();
