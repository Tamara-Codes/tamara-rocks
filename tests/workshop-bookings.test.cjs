const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { sqlStatements } = require('../scripts/sql-statements.cjs');
const b = require('../api/_bookings');

test('paid form validation binds bookings to a session and validates email, consent and timezone', () => {
    const body = { sessionId: b.SESSION_IDS[0], email: ' Ana.B.C@example.com ', consent: true, timezone: 'America/New_York' };
    assert.equal(b.validateBooking(body), null);
    assert.ok(b.validateBooking({ ...body, consent: false }));
    assert.ok(b.validateBooking({ ...body, sessionId: 'invented' }));
    assert.ok(b.validateBooking({ ...body, email: 'invalid' }));
    assert.ok(b.validateBooking({ ...body, timezone: 'Unknown/place' }));
    assert.ok(b.validateBooking({ ...body, name: '<'.repeat(101) }));
});
test('payment links and origins cannot point to an arbitrary site', () => {
    assert.equal(b.validPaymentLink('https://buy.stripe.com/example'), true);
    for (const link of ['javascript:alert(1)', 'http://buy.stripe.com/x', 'https://buy.stripe.com.evil.test/x', 'https://user@buy.stripe.com/x']) assert.equal(b.validPaymentLink(link), false);
    assert.equal(b.sameOrigin({ headers: { origin: 'https://evil.test' } }), false);
    assert.equal(b.sameOrigin({ headers: {} }), false);
});
test('emails contain the chosen session in the attendee timezone and escape user content', () => {
    const email = b.emailContent({ kind: 'reservation', payload: { title: 'Lead Generation', startsAt: '2026-11-25T18:00:00Z', timezone: 'America/New_York', durationMinutes: 90, currency: 'EUR', priceCents: 4900, cancelUrl: 'https://www.tamara.rocks/workshop-reservation.html#abc' } });
    assert.match(email.text, /25 November 2026 at 13:00/);
    assert.match(email.text, /48 hours from that email/);
    assert.match(email.html, /Manage my reservation/);
    const owner = b.emailContent({ kind: 'owner', payload: { name: '<img src=x onerror=alert(1)>', email: 'a@example.test', title: 'Workshop', startsAt: '2026-11-25T18:00:00Z', timezone: 'Europe/Zagreb', durationMinutes: 90, currency: 'EUR', priceCents: 4900 } });
    assert.doesNotMatch(owner.html, /<img src=x/);
    assert.match(owner.html, /&lt;img/);
});
test('SQL migration splitter keeps function bodies intact', () => {
    assert.equal(sqlStatements("SELECT ';'; CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END; $$;").length, 2);
    const statements = sqlStatements(fs.readFileSync(path.join(__dirname, '../migrations/20261119_workshop_bookings.sql'), 'utf8'));
    assert.equal(statements.filter(s=>s.includes('CREATE OR REPLACE FUNCTION')).length, 4);
    assert.ok(statements.every(s=>!s.includes('INSERT INTO workshop_signups')));
});
test('private bookings require a signed, expiring cookie', () => {
    const oldSecret = process.env.WORKSHOP_ADMIN_SECRET;
    const oldLocal = process.env.BOOKING_LOCAL_DEV;
    process.env.WORKSHOP_ADMIN_SECRET = 'test-only-secret-'.repeat(4);
    process.env.BOOKING_LOCAL_DEV = 'false';
    try {
        let cookie;
        b.setAdminCookie({ setHeader(name, value) { cookie = value; } });
        assert.match(cookie, /HttpOnly; SameSite=Strict/); assert.match(cookie, /; Secure/);
        assert.equal(b.adminAuthorized({ headers: { cookie } }), true);
        assert.equal(b.adminAuthorized({ headers: {} }), false);
        assert.equal(b.adminAuthorized({ headers: { cookie: cookie.replace(/workshop_admin=\d+/, 'workshop_admin=1') } }), false);
        process.env.WORKSHOP_ADMIN_SECRET = 'a-different-secret-'.repeat(3);
        assert.equal(b.adminAuthorized({ headers: { cookie } }), false);
    } finally {
        if (oldSecret == null) delete process.env.WORKSHOP_ADMIN_SECRET; else process.env.WORKSHOP_ADMIN_SECRET = oldSecret;
        if (oldLocal == null) delete process.env.BOOKING_LOCAL_DEV; else process.env.BOOKING_LOCAL_DEV = oldLocal;
    }
});

test('email failures retain a saved outbox job, and successful payment mail starts the deadline', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../api/_bookings.js'), 'utf8');
    for (const fails of [true, false]) {
        const queries = [], transactions = [], sends = [];
        const job = { id: 55, booking_id: randomUUID(), booking_version: 2, kind: 'payment', attempts: 1, payload: { title: 'Workshop', startsAt: '2026-11-25T18:00:00Z', timezone: 'Europe/Zagreb', durationMinutes: 90, currency: 'EUR', priceCents: 4900, email: 'test@example.test', paymentLink: 'https://buy.stripe.com/test' } };
        const sql = (strings, ...values) => { const query = strings.join('?'); queries.push({ query, values }); return Promise.resolve(query.includes('WITH selected') ? [job] : []); };
        sql.transaction = async q => { transactions.push(q); await Promise.all(q); };
        const context = { module: { exports: {} }, process: { env: { RESEND_API_KEY: 'test', RESEND_FROM_EMAIL: 'Tamara <test@example.test>' } }, Buffer, URL, URLSearchParams, Intl, console,
            require(name) { if (name === 'resend') return { Resend: class { emails = { send: async (...args) => { sends.push(args); return fails ? { error: { message: 'temporary' } } : { data: { id: 'email-test' } }; } }; } };
                if (name === '@neondatabase/serverless') return { neon: () => sql };
                return require(name === './_email' ? '../api/_email' : name); }
        };
        vm.runInNewContext(source, context);
        const result = await context.module.exports.dispatchEmails(sql);
        assert.equal(result.sent, fails ? 0 : 1);
        assert.equal(sends[0][1].idempotencyKey, 'paid-workshop-email-55');
        assert.equal(queries.some(q=>q.query.includes('retry scheduled')), fails);
        assert.equal(queries.some(q=>q.query.includes('payment_due_at = COALESCE')), !fails);
        assert.equal(transactions.length, fails ? 0 : 1);
    }
});

test('database enforces capacity under simultaneous requests, duplicates, waitlist priority and payment expiry', { skip: process.env.BOOKING_INTEGRATION !== 'true' }, async () => {
    assert.equal(process.env.BOOKING_LOCAL_DEV, 'true', 'Integration tests require the isolated development branch.');
    assert.equal(process.env.BOOKING_EMAIL_MODE, 'preview');
    const sql = b.db();
    const run = randomUUID(), group = `test-${run}`, first = `${group}-a`, second = `${group}-b`;
    const before = await sql`SELECT COUNT(*)::int AS n FROM workshop_signups`;
    await sql`INSERT INTO workshop_sessions(id, workshop_slug, title, starts_at) VALUES (${first},${group},'Integration test',NOW()+INTERVAL '7 days'),(${second},${group},'Integration test',NOW()+INTERVAL '8 days')`;
    const reserve = async (session, email) => {
        const [row] = await sql`SELECT workshop_reserve(${randomUUID()}::uuid,${session},${email},'Test participant','Europe/Zagreb',${randomBytes(32).toString('hex')},'https://example.test/manage#test') AS r`;
        return row.r;
    };
    const emails = Array.from({ length: 20 }, (_, i)=>`capacity-${i}-${run}@example.test`);
    await Promise.all([...emails, ...Array(5).fill(emails[0])].map(email=>reserve(first,email)));
    let [counts] = await sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='reserved')::int AS reserved, COUNT(*) FILTER (WHERE status='waitlisted')::int AS waiting FROM workshop_bookings WHERE session_id=${first}`;
    assert.deepEqual(counts, { total: 20, reserved: 8, waiting: 12 });
    const cross = await reserve(second,emails[0]); assert.equal(cross.duplicate,true);
    const separate = await reserve(second,`separate-${run}@example.test`); assert.equal(separate.status,'reserved');
    const [active] = await sql`SELECT id FROM workshop_bookings WHERE session_id=${first} AND status='reserved' LIMIT 1`;
    await sql`SELECT workshop_manage_booking(${active.id}::uuid,'cancel')`;
    const late = await reserve(first,`late-${run}@example.test`); assert.equal(late.status,'waitlisted');
    const waiting = await sql`SELECT id FROM workshop_bookings WHERE session_id=${first} AND status='waitlisted' ORDER BY created_at,id LIMIT 2`;
    const [outOfOrder] = await sql`SELECT workshop_manage_booking(${waiting[1].id}::uuid,'promote',NULL,'test-hash','https://example.test') AS r`; assert.equal(outOfOrder.r.error,'waiting_order');
    const [promoted] = await sql`SELECT workshop_manage_booking(${waiting[0].id}::uuid,'promote',NULL,${randomBytes(32).toString('hex')},'https://example.test') AS r`; assert.equal(promoted.r.ok,true);
    await sql`SELECT workshop_manage_booking(${separate.id}::uuid,'invite_payment','https://buy.stripe.com/test')`;
    const [pending] = await sql`SELECT status,payment_due_at FROM workshop_bookings WHERE id=${separate.id}`;
    assert.equal(pending.status,'payment_pending'); assert.equal(pending.payment_due_at,null);
    await sql`UPDATE workshop_bookings SET payment_due_at=NOW()-INTERVAL '1 second' WHERE id=${separate.id}`;
    await sql`SELECT workshop_expire_session(${second})`;
    const [expired] = await sql`SELECT status,seat_no FROM workshop_bookings WHERE id=${separate.id}`;
    assert.deepEqual(expired,{status:'expired',seat_no:null});
    const paid = await reserve(second,`paid-${run}@example.test`);
    await sql`SELECT workshop_manage_booking(${paid.id}::uuid,'invite_payment','https://buy.stripe.com/test')`;
    await sql`SELECT workshop_manage_booking(${paid.id}::uuid,'mark_paid')`;
    const [cannotCancel] = await sql`SELECT workshop_manage_booking(${paid.id}::uuid,'cancel') AS r`; assert.equal(cannotCancel.r.error,'paid_booking');
    const [outbox] = await sql`SELECT COUNT(*)::int AS n FROM workshop_booking_email_outbox o JOIN workshop_bookings b ON b.id=o.booking_id WHERE b.workshop_slug=${group}`;
    assert.ok(outbox.n >= 40);
    assert.deepEqual(await sql`SELECT COUNT(*)::int AS n FROM workshop_signups`,before);
});
