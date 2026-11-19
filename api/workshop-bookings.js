const b = require('./_bookings');

module.exports = async (req, res) => {
    b.headers(res);
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
    try {
        const sql = b.db();
        if (req.method === 'GET') return res.status(200).json({ sessions: await b.availability(sql) });
        if (!b.sameOrigin(req)) return res.status(403).json({ error: 'Please submit your reservation from the workshops page.' });
        if (req.body?._honey) return res.status(400).json({ error: 'Please refresh the page and try again.' });
        const error = b.validateBooking(req.body);
        if (error) return res.status(400).json({ error });
        if (!(await b.rateLimit(sql, 'reservation', req))) return res.status(429).json({ error: 'Please wait a little before trying again.' });
        if (!(await b.botCheck(req.body, req))) return res.status(400).json({ error: 'Bot check failed. Please refresh and try again.' });
        const { tokenHash, url } = b.cancelCredentials();
        const [row] = await sql`SELECT workshop_reserve(${b.randomUUID()}::uuid, ${req.body.sessionId}, ${req.body.email.trim().toLowerCase()},
            ${(req.body.name || '').trim()}, ${req.body.timezone || 'Europe/Zagreb'}, ${tokenHash}, ${url}) AS booking`;
        const result = row.booking;
        if (result.error) return res.status(409).json({ error: 'Reservations for this session are closed.' });
        if (result.duplicate) return res.status(200).json({ ok: true, alreadyRegistered: true, sessions: await b.availability(sql) });
        // Mail errors must never roll back a saved reservation or tell someone to book twice.
        let mail = { queued: true };
        try { mail = await b.dispatchEmails(sql, { bookingId: result.id }); } catch { console.error('Paid workshop email remains queued.'); }
        return res.status(201).json({ ok: true, status: result.status, emailQueued: mail.queued === true || !mail.sent,
            development: process.env.BOOKING_LOCAL_DEV === 'true', sessions: await b.availability(sql) });
    } catch {
        console.error('Paid workshop booking request failed.');
        return res.status(503).json({ error: 'Reservations are temporarily unavailable. Please try again or email tamara@nosastra.co.' });
    }
};
