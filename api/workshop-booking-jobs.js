const b = require('./_bookings');
module.exports = async (req, res) => {
    b.headers(res);
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
    if (!process.env.CRON_SECRET || !b.sameSecret(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ error: 'Unauthorised.' });
    try {
        const sql = b.db();
        for (const id of b.SESSION_IDS) await sql`SELECT workshop_expire_session(${id})`;
        return res.status(200).json({ ok: true, ...await b.dispatchEmails(sql, { limit: 10 }) });
    } catch { return res.status(503).json({ error: 'Retry job failed.' }); }
};
