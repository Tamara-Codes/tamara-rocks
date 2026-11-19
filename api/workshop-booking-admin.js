const b = require('./_bookings');

module.exports = async (req, res) => {
    b.headers(res);
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
    if (!b.adminConfigured()) return res.status(503).json({ error: 'The private bookings page has not been configured.' });
    if (req.method === 'POST' && !b.sameOrigin(req)) return res.status(403).json({ error: 'Please use the private bookings page.' });
    try {
        const sql = b.db();
        const action = req.body?.action;
        if (req.method === 'POST' && action === 'local_login' && process.env.BOOKING_LOCAL_DEV === 'true' &&
            ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) {
            b.setAdminCookie(res);
            return res.status(200).json({ ok: true });
        }
        if (req.method === 'POST' && action === 'login') {
            if (!(await b.rateLimit(sql, 'admin-login', req, 5, 900))) return res.status(429).json({ error: 'Please wait 15 minutes before trying again.' });
            if (!b.sameSecret(req.body.secret, process.env.WORKSHOP_ADMIN_SECRET)) return res.status(401).json({ error: 'That access key was not recognised.' });
            b.setAdminCookie(res);
            return res.status(200).json({ ok: true });
        }
        if (!b.adminAuthorized(req)) return res.status(401).json({ error: 'Please sign in to view bookings.' });
        if (req.method === 'GET') {
            // Expiration is serialized with seat allocation.
            for (const id of b.SESSION_IDS) await sql`SELECT workshop_expire_session(${id})`;
            const bookings = await sql`SELECT b.id, b.session_id, b.email, b.name, b.timezone, b.status, b.created_at,
                b.payment_invited_at, b.payment_due_at, b.paid_at,
                (SELECT COUNT(*)::int FROM workshop_booking_email_outbox o WHERE o.booking_id = b.id AND o.booking_version = b.version AND o.sent_at IS NULL) AS emails_pending,
                (SELECT COUNT(*)::int FROM workshop_booking_email_outbox o WHERE o.booking_id = b.id AND o.booking_version = b.version AND o.last_error IS NOT NULL AND o.sent_at IS NULL) AS emails_failed
                FROM workshop_bookings b WHERE b.session_id = ANY(${b.SESSION_IDS}) ORDER BY b.created_at, b.id LIMIT 1000`;
            return res.status(200).json({ sessions: await b.availability(sql), bookings, development: process.env.BOOKING_LOCAL_DEV === 'true' });
        }
        if (action === 'logout') { b.setAdminCookie(res, true); return res.status(200).json({ ok: true }); }
        if (action === 'retry_emails') {
            await sql`UPDATE workshop_booking_email_outbox SET next_attempt_at = NOW()
                WHERE sent_at IS NULL AND attempts < 8 AND (lease_until IS NULL OR lease_until < NOW())`;
            return res.status(200).json({ ok: true, ...await b.dispatchEmails(sql, { limit: 10 }) });
        }
        if (!['invite_payment', 'mark_paid', 'cancel', 'promote'].includes(action) || !/^[a-f0-9-]{36}$/i.test(req.body.id || '')) return res.status(400).json({ error: 'Please choose a valid booking action.' });
        if (action === 'invite_payment' && !b.validPaymentLink(req.body.paymentLink)) return res.status(400).json({ error: 'Please enter an HTTPS Stripe Payment Link.' });
        const creds = b.cancelCredentials();
        const [row] = await sql`SELECT workshop_manage_booking(${req.body.id}::uuid, ${action}, ${req.body.paymentLink || null}, ${creds.tokenHash}, ${creds.url}) AS result`;
        if (row.result.error) {
            const messages = { paid_booking: 'This booking is paid. Handle any refund before cancelling it.', full: 'This session is full.', waiting_order: 'Offer the place to the first person on the waiting list.', invalid_status: 'This booking has changed. Refresh the list before trying again.' };
            return res.status(409).json({ error: messages[row.result.error] || 'This booking could not be updated.' });
        }
        try { await b.dispatchEmails(sql, { bookingId: req.body.id }); } catch { console.error('Booking update email remains queued.'); }
        return res.status(200).json({ ok: true });
    } catch { console.error('Workshop administration request failed.'); return res.status(503).json({ error: 'Bookings are temporarily unavailable. Please try again.' }); }
};
