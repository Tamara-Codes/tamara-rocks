const { neon } = require('@neondatabase/serverless');
const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { Resend } = require('resend');
const { renderEmail } = require('./_email');

const SESSION_IDS = ['lead-generation-2026-11-25', 'lead-generation-2026-11-28'];
const COOKIE = 'workshop_admin';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
function db() {
    const url = process.env.BOOKINGS_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) throw new Error('Booking database is not configured.');
    return neon(url);
}
function headers(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
}
function sameOrigin(req) {
    if (!req.headers.origin) return false;
    const allowed = new URL(process.env.SITE_URL || 'https://www.tamara.rocks').origin;
    return req.headers.origin === allowed || (process.env.BOOKING_LOCAL_DEV === 'true' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin));
}
function validateBooking(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Please complete the booking form.';
    if (!SESSION_IDS.includes(body.sessionId)) return 'Please choose one of the available sessions.';
    if (typeof body.email !== 'string' || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return 'Please enter a valid email address.';
    if (body.name != null && (typeof body.name !== 'string' || body.name.trim().length > 100)) return 'Please keep your name to 100 characters or fewer.';
    if (body.consent !== true) return 'Please agree to receive your reservation and booking details.';
    if (body.timezone != null) {
        if (typeof body.timezone !== 'string' || body.timezone.length > 100) return 'Please refresh the page and try again.';
        try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); } catch { return 'Please refresh the page and try again.'; }
    }
    return null;
}
async function rateLimit(sql, scope, req, limit = 8, seconds = 900) {
    const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const salt = process.env.RATE_LIMIT_SALT || process.env.BOOKINGS_DATABASE_URL || process.env.DATABASE_URL;
    const key = hash(`${scope}:${ip}:${salt}`);
    const rows = await sql`INSERT INTO workshop_booking_rate_limits(key, attempts) VALUES (${key}, 1)
        ON CONFLICT (key) DO UPDATE SET
            attempts = CASE WHEN workshop_booking_rate_limits.window_started_at < NOW() - (${seconds} * INTERVAL '1 second') THEN 1 ELSE workshop_booking_rate_limits.attempts + 1 END,
            window_started_at = CASE WHEN workshop_booking_rate_limits.window_started_at < NOW() - (${seconds} * INTERVAL '1 second') THEN NOW() ELSE workshop_booking_rate_limits.window_started_at END
        RETURNING attempts`;
    return rows[0].attempts <= limit;
}
async function botCheck(body, req) {
    if (!process.env.TURNSTILE_SECRET_KEY) return true;
    if (!body.turnstileToken) return false;
    try {
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: body.turnstileToken }),
        });
        return r.ok && (await r.json()).success === true;
    } catch { return false; }
}
function cancelCredentials() {
    const token = randomBytes(32).toString('hex');
    const origin = new URL(process.env.SITE_URL || 'https://www.tamara.rocks').origin;
    return { tokenHash: hash(token), url: `${origin}/workshop-reservation.html#${token}` };
}
async function availability(sql) {
    const rows = await sql`SELECT s.id, s.starts_at, s.duration_minutes, s.capacity, s.price_cents, s.currency,
        (s.booking_open AND s.starts_at > NOW()) AS open,
        COUNT(b.id) FILTER (WHERE b.status IN ('reserved', 'paid') OR (b.status = 'payment_pending' AND (b.payment_due_at IS NULL OR b.payment_due_at > NOW())))::int AS occupied,
        COUNT(b.id) FILTER (WHERE b.status = 'waitlisted')::int AS waiting
        FROM workshop_sessions s LEFT JOIN workshop_bookings b ON b.session_id = s.id
        WHERE s.id = ANY(${SESSION_IDS}) GROUP BY s.id ORDER BY s.starts_at`;
    return rows.map((r) => ({ id: r.id, startsAt: r.starts_at, durationMinutes: r.duration_minutes,
        capacity: r.capacity, priceCents: r.price_cents, currency: r.currency, open: r.open,
        remaining: r.waiting > 0 ? 0 : Math.max(0, r.capacity - r.occupied) }));
}
function validPaymentLink(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && ['buy.stripe.com', 'checkout.stripe.com'].includes(u.hostname) && !u.username && !u.password; } catch { return false; }
}
function adminConfigured() { return process.env.WORKSHOP_ADMIN_SECRET?.length >= 32; }
function signedSession(expires) { return `${expires}.${createHmac('sha256', process.env.WORKSHOP_ADMIN_SECRET).update(`workshop-admin:${expires}`).digest('hex')}`; }
function adminAuthorized(req) {
    if (!adminConfigured()) return false;
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const expires = Number(token?.split('.')[0]);
    return Number.isSafeInteger(expires) && expires > Date.now() && expires <= Date.now() + 8 * 3600000 && sameSecret(token, signedSession(expires));
}
function setAdminCookie(res, logout = false) {
    const token = logout ? '' : signedSession(Date.now() + 8 * 3600000);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/api/workshop-booking-admin; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : 28800}${process.env.BOOKING_LOCAL_DEV === 'true' ? '' : '; Secure'}`);
}
function emailContent(job) {
    const p = job.payload;
    const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: p.timezone || 'Europe/Zagreb' }).format(new Date(p.startsAt));
    const price = new Intl.NumberFormat('en', { style: 'currency', currency: p.currency }).format(p.priceCents / 100);
    const content = {
        reservation: ['Your workshop place is reserved', 'One of the eight places is yours.', 'The AI workflows are ready; my checkout is still catching up. Your place is reserved. I’ll email your payment link when it’s ready, and you’ll have 48 hours from that email to pay and confirm your booking.'],
        waitlist: ['You’re on the workshop waiting list', 'You’re on the waiting list.', 'This session’s eight places are currently reserved. There’s nothing to pay. I’ll email you if a place becomes available.'],
        payment: ['Your workshop payment link', 'Let’s make it official.', `Your payment link is ready. Please pay ${price} within 48 hours of this email to confirm your place. If you no longer plan to join, you can reply to this email.`],
        paid: ['Your paid workshop booking is confirmed', 'You’re booked in.', 'Your payment has been recorded and your booking is confirmed. I’ll email the joining link before the session. Bring your questions!'],
        cancelled: ['Your workshop reservation is cancelled', 'Your reservation is cancelled.', 'Your place has been released. Thank you for letting me know. You can reply to this email if you need help.'],
        owner: ['New paid workshop registration', 'Someone signed up.', `${p.name || '(No name supplied)'} · ${p.email} · ${p.status}. Open the private bookings page to manage this registration.`],
    }[job.kind];
    const buttonUrl = job.kind === 'payment' ? p.paymentLink : job.kind === 'owner'
        ? `${new URL(process.env.SITE_URL || 'https://www.tamara.rocks').origin}/workshop-admin.html` : p.cancelUrl || '';
    return { subject: content[0], text: `${content[1]}\n\n${content[2]}\n\n${p.title}\n${when} (${p.timezone})\n${p.durationMinutes} minutes · Live online · ${price}\n${buttonUrl}\n\nReply to tamara@nosastra.co for help.`,
        html: renderEmail({ title: content[0], eyebrow: 'Live AI workshop', heading: content[1], intro: content[2],
            panelLabel: p.title, panelText: `${when} (${p.timezone}) · ${p.durationMinutes} minutes · ${price}`,
            panelNote: 'Times are shown in the timezone used when you registered. Reply to this email if you have a question.',
            buttonUrl, buttonLabel: job.kind === 'payment' ? 'Pay for my place' : job.kind === 'owner' ? 'Open workshop bookings' : 'Manage my reservation',
            footer: 'You received this transactional email about a paid workshop reservation at tamara.rocks.' }) };
}
async function dispatchEmails(sql, { bookingId = null, limit = 6 } = {}) {
    // Development still saves to the branch, but never sends mail.
    if (process.env.BOOKING_EMAIL_MODE === 'preview') return { sent: 0, preview: true };
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return { sent: 0, queued: true };
    const lease = randomBytes(16).toString('hex');
    const jobs = await sql`WITH selected AS (
        SELECT o.id FROM workshop_booking_email_outbox o JOIN workshop_bookings b ON b.id = o.booking_id
        WHERE o.sent_at IS NULL AND o.attempts < 8 AND o.next_attempt_at <= NOW()
            AND (o.lease_until IS NULL OR o.lease_until < NOW())
            AND (o.kind = 'owner' OR o.booking_version = b.version)
            AND (${bookingId}::uuid IS NULL OR o.booking_id = ${bookingId}::uuid)
        ORDER BY o.id LIMIT ${limit} FOR UPDATE OF o SKIP LOCKED
    ) UPDATE workshop_booking_email_outbox o SET lease_token = ${lease}, lease_until = NOW() + INTERVAL '2 minutes', attempts = attempts + 1
    FROM selected WHERE o.id = selected.id RETURNING o.id, o.booking_id, o.booking_version, o.kind, o.payload, o.attempts`;
    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0;
    for (const job of jobs) {
        try {
            const content = emailContent(job);
            const response = await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL,
                to: [job.kind === 'owner' ? (process.env.WORKSHOP_NOTIFY_EMAIL || 'tamara@nosastra.co') : job.payload.email],
                replyTo: 'tamara@nosastra.co', ...content }, { idempotencyKey: `paid-workshop-email-${job.id}` });
            if (response.error || !response.data?.id) throw new Error('Email provider declined message.');
            await sql.transaction([
                sql`UPDATE workshop_booking_email_outbox SET sent_at = NOW(), provider_id = ${response.data?.id || ''}, lease_until = NULL, last_error = NULL
                    WHERE id = ${job.id} AND lease_token = ${lease}`,
                sql`UPDATE workshop_bookings SET payment_invited_at = COALESCE(payment_invited_at, NOW()), payment_due_at = COALESCE(payment_due_at, NOW() + INTERVAL '48 hours')
                    WHERE id = ${job.booking_id} AND version = ${job.booking_version} AND status = 'payment_pending' AND ${job.kind} = 'payment'`,
            ]);
            sent++;
        } catch {
            await sql`UPDATE workshop_booking_email_outbox SET lease_until = NULL, last_error = 'Delivery failed; retry scheduled.',
                next_attempt_at = NOW() + (LEAST(3600, 60 * power(2, attempts)) * INTERVAL '1 second')
                WHERE id = ${job.id} AND lease_token = ${lease}`;
        }
    }
    return { sent, queued: sent < jobs.length };
}
module.exports = { db, headers, sameOrigin, validateBooking, rateLimit, botCheck, cancelCredentials, availability,
    validPaymentLink, adminConfigured, adminAuthorized, setAdminCookie, sameSecret, hash, randomUUID, emailContent, dispatchEmails, SESSION_IDS };
