(function () {
    var output = document.getElementById('visitorCount');
    if (!output) return;

    var returningVisitor = /(?:^|;\s*)tamara_rocks_visitor=1(?:;|$)/.test(document.cookie);
    fetch('/api/visitor-count', {
        method: returningVisitor ? 'GET' : 'POST',
        credentials: 'same-origin'
    })
        .then(function (response) {
            // A second tab may have registered us while this request started.
            if (response.status === 204) {
                return fetch('/api/visitor-count', { credentials: 'same-origin' });
            }
            return response;
        })
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
