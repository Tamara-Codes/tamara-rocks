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

async function ensureCounterTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS site_counters (
      name TEXT PRIMARY KEY,
      visits BIGINT NOT NULL DEFAULT 0 CHECK (visits >= 0)
    )
  `;
}

module.exports = async function visitorCount(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Visitor counter is not configured yet.' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureCounterTable(sql);

    const returningVisitor = hasVisited(req.headers.cookie);
    let rows;

    if (returningVisitor) {
      rows = await sql`SELECT visits FROM site_counters WHERE name = ${COUNTER_NAME}`;
    } else {
      rows = await sql`
        INSERT INTO site_counters (name, visits)
        VALUES (${COUNTER_NAME}, 1)
        ON CONFLICT (name) DO UPDATE SET visits = site_counters.visits + 1
        RETURNING visits
      `;
      res.setHeader('Set-Cookie', visitorCookie(req));
    }

    const visits = rows[0] ? Number(rows[0].visits) : 0;
    return res.status(200).json({ visits });
  } catch (error) {
    console.error('Visitor counter failed:', error);
    return res.status(500).json({ error: 'Visitor counter is temporarily unavailable.' });
  }
};
