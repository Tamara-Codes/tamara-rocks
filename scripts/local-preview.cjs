const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateFeedback } = require('../api/workshop-feedback');

// Never load .env.local. Paid bookings use an explicit, isolated development branch.
const bookingRoutes = {
    '/api/workshop-bookings': require('../api/workshop-bookings'),
    '/api/workshop-booking-admin': require('../api/workshop-booking-admin'),
    '/api/workshop-booking-cancel': require('../api/workshop-booking-cancel'),
};
if (process.env.BOOKINGS_DATABASE_URL && (process.env.BOOKING_LOCAL_DEV !== 'true' || process.env.BOOKING_EMAIL_MODE !== 'preview')) {
    throw new Error('Local bookings require development mode with email sending disabled.');
}
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PREVIEW_PORT || 4173);
const contentTypes = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const pathname = decodeURIComponent(url.pathname);

        if (bookingRoutes[pathname]) {
            if (!process.env.BOOKINGS_DATABASE_URL || process.env.BOOKING_LOCAL_DEV !== 'true' || process.env.BOOKING_EMAIL_MODE !== 'preview') {
                return json(res, 503, { error: 'The isolated booking development database is not configured.' });
            }
            let raw = '';
            for await (const chunk of req) {
                raw += chunk;
                if (Buffer.byteLength(raw) > 8192) return json(res, 413, { error: 'Request too large.' });
            }
            try { req.body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'Invalid request.' }); }
            res.status = code => { res.statusCode = code; return res; };
            res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
            return await bookingRoutes[pathname](req, res);
        }

        if (pathname === '/api/workshop-signup' || pathname === '/api/workshop-feedback') {
            if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
            let raw = '';
            for await (const chunk of req) {
                raw += chunk;
                if (Buffer.byteLength(raw) > (pathname === '/api/workshop-feedback' ? 32768 : 8192)) return json(res, 413, { error: 'Request too large.' });
            }
            let body;
            try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid request.' }); }
            let error;
            if (pathname === '/api/workshop-feedback') error = validateFeedback(body);
            else {
                const email = String(body?.email || '').trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = 'Please enter a valid email address.';
                else if ((email.split('@')[0].match(/\./g) || []).length > 1) error = 'Please use an email address with at most one dot before @.';
            }
            if (error) return json(res, 400, { error });
            return json(res, 200, { ok: true, preview: true });
        }

        // Stub the existing site's analytics/counter in the local preview.
        if (pathname === '/api/visitor-count') return json(res, 200, { visits: 0 });
        if (pathname.startsWith('/_vercel/')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(''); }
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
        const relative = pathname === '/' ? 'index.html'
            : /^\/workshops\/?$/.test(pathname) ? 'workshops.html'
            : /^\/workshop-feedback\/?$/.test(pathname) ? 'workshop-feedback.html'
            : pathname.replace(/^\/+/, '');
        if (relative.split(/[\\/]/).some((part) => part.startsWith('.') || ['api', 'node_modules', 'tests', 'scripts', 'migrations'].includes(part))) {
            res.writeHead(404); return res.end('Not found');
        }
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !contentTypes[path.extname(file)]) { res.writeHead(404); return res.end('Not found'); }
        let content = await fs.readFile(file);
        if (path.extname(file) === '.html') {
            content = Buffer.from(content.toString('utf8').replace('</head>', '<script>window.__WORKSHOPS_PREVIEW__ = true; window.__BOOKING_LOCAL_DEV__ = true;</script></head>'));
        }
        res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)], 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 400);
        res.end(error.code === 'ENOENT' ? 'Not found' : 'Invalid request');
    }
});

server.listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port}/workshops`));
