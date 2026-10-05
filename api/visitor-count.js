const { neon } = require('@neondatabase/serverless');

const COUNTER_NAME = 'tamara.rocks';
const VISITOR_COOKIE = 'tamara_rocks_visitor';

function hasVisited(cookieHeader) {
  return new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=1(?:;|$)`).test(cookieHeader || '');
}

function visitorCookie(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '');
  const isSecure = forwardedProto.split(',')[0].trim() === 'https';
  return `${VISITOR_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${isSecure ? '; Secure' : ''}`;
}

module.exports = async function visitorCount(req, res) {
  // Errors and registration responses must never enter a shared cache.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Another page may already have registered this visitor. Do not query Neon
  // again; the browser can read the public, cached total instead.
  if (req.method === 'POST' && hasVisited(req.headers.cookie)) {
    return res.status(204).end();
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Visitor counter is not configured yet.' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    let rows;

    if (req.method === 'GET') {
      // GET is identical for everyone and never increments or sets a cookie.
      rows = await sql`SELECT visits FROM site_counters WHERE name = ${COUNTER_NAME}`;
    } else {
      // The existing table is provisioned outside the request handler.
      rows = await sql`
        INSERT INTO site_counters (name, visits)
        VALUES (${COUNTER_NAME}, 1)
        ON CONFLICT (name) DO UPDATE SET visits = site_counters.visits + 1
        RETURNING visits
      `;
      res.setHeader('Set-Cookie', visitorCookie(req));
    }

    const visits = rows[0] ? Number(rows[0].visits) : 0;
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=3600');
    }
    return res.status(200).json({ visits });
  } catch (error) {
    console.error('Visitor counter failed:', error);
    return res.status(500).json({ error: 'Visitor counter is temporarily unavailable.' });
  }
};
