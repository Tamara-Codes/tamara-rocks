const b = require('./_bookings');
module.exports = async (req, res) => {
    b.headers(res);
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
    if (req.method === 'POST' && !b.sameOrigin(req)) return res.status(403).json({ error: 'Please use your reservation link.' });
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(404).json({ error: 'This reservation link is not valid.' });
    try {
        const sql = b.db();
        const rows = await sql`SELECT b.id, b.status, s.title, s.starts_at FROM workshop_bookings b JOIN workshop_sessions s ON s.id = b.session_id WHERE b.cancel_token_hash = ${b.hash(token)}`;
        if (!rows.length) return res.status(404).json({ error: 'This reservation link is not valid.' });
        const booking = rows[0];
        if (req.method === 'GET') return res.status(200).json({ status: booking.status, title: booking.title, startsAt: booking.starts_at });
        const [row] = await sql`SELECT workshop_manage_booking(${booking.id}::uuid, 'cancel') AS result`;
        if (row.result.error) return res.status(409).json({ error: 'This booking is paid. Please email tamara@nosastra.co for help with cancellation.' });
        try { await b.dispatchEmails(sql, { bookingId: booking.id }); } catch { console.error('Cancellation email remains queued.'); }
        return res.status(200).json({ ok: true });
    } catch { return res.status(503).json({ error: 'Please try again or email tamara@nosastra.co.' }); }
};
