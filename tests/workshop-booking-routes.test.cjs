const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const actual = require('../api/_bookings');
function fixture(route, overrides = {}, env = {}) {
    const activity = { queries: [], mails: 0 };
    const sql = async (strings, ...values) => {
        const query = strings.join('?'); activity.queries.push({ query, values });
        if (query.includes('workshop_reserve')) return [{ booking: { id: '00000000-0000-4000-8000-000000000001', status: 'reserved', sessionId: actual.SESSION_IDS[0] } }];
        return [];
    };
    const helpers = { ...actual, db: () => sql, sameOrigin: () => true, availability: async () => [{ id: actual.SESSION_IDS[0], remaining: 7 }],
        rateLimit: async () => true, botCheck: async () => true, adminConfigured: () => true, adminAuthorized: () => false,
        dispatchEmails: async () => { activity.mails++; return { sent: 1 }; }, ...overrides };
    const context = { module: { exports: {} }, process: { env }, console: { error() {} }, require: () => helpers };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api', route), 'utf8'), context);
    return { activity, async request({ method = 'GET', body = {}, headers = {}, socket = {} } = {}) {
        const response = { headers: {}, setHeader(key,value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await context.module.exports({ method, body, headers, socket }, response); return response;
    } };
}
const valid = { email: 'a@example.test', name: 'Ana', sessionId: actual.SESSION_IDS[0], consent: true };
test('public availability exposes only session counts and failures do not fake availability', async () => {
    const f = fixture('workshop-bookings.js'); const r = await f.request();
    assert.equal(r.code,200); assert.equal(r.headers['Cache-Control'],'no-store'); assert.deepEqual(Object.keys(r.body),['sessions']);
    const down = fixture('workshop-bookings.js',{ db() { throw new Error('offline'); } }); assert.equal((await down.request()).code,503);
});
test('paid booking rejects cross-origin and invalid submissions before allocation', async () => {
    const cross = fixture('workshop-bookings.js',{ sameOrigin: () => false }); assert.equal((await cross.request({method:'POST',body:valid})).code,403);
    assert.equal(cross.activity.queries.length,0);
    const bad = fixture('workshop-bookings.js'); assert.equal((await bad.request({method:'POST',body:{...valid,consent:false}})).code,400); assert.equal(bad.activity.queries.length,0);
});
test('a saved booking still succeeds when email delivery fails', async () => {
    const f = fixture('workshop-bookings.js',{ dispatchEmails: async () => { throw new Error('provider down'); } });
    const r = await f.request({method:'POST',body:valid}); assert.equal(r.code,201); assert.equal(r.body.ok,true); assert.equal(r.body.emailQueued,true);
    assert.equal(f.activity.queries.length,1); assert.equal('id' in r.body,false);
});
test('anonymous visitors cannot read participant data or invoke local login in production', async () => {
    const f = fixture('workshop-booking-admin.js'); assert.equal((await f.request()).code,401);
    assert.equal((await f.request({method:'POST',body:{action:'local_login'},socket:{remoteAddress:'127.0.0.1'}})).code,401);
    assert.equal(f.activity.queries.length,0);
});
test('admin payment invitations reject arbitrary URLs before any mutation', async () => {
    const f = fixture('workshop-booking-admin.js',{adminAuthorized:()=>true});
    const r = await f.request({method:'POST',body:{action:'invite_payment',id:'00000000-0000-4000-8000-000000000001',paymentLink:'https://evil.test'}});
    assert.equal(r.code,400); assert.equal(f.activity.queries.length,0);
});
test('opening a cancellation link does not cancel or expose attendee details', async () => {
    const f = fixture('workshop-booking-cancel.js',{ db: () => async(strings) => {
        assert.ok(!strings.join('?').includes('workshop_manage_booking')); return [{id:'test',status:'reserved',title:'Workshop',starts_at:'2026-11-25T18:00:00Z'}];
    }});
    const r = await f.request({headers:{authorization:'Bearer '+'a'.repeat(64)}}); assert.equal(r.code,200); assert.equal('email' in r.body,false); assert.equal('id' in r.body,false);
});
test('the retry worker requires its own cron credential', async () => {
    const f = fixture('workshop-booking-jobs.js',{}, {CRON_SECRET:'test-secret'});
    assert.equal((await f.request()).code,401); assert.equal(f.activity.queries.length,0);
});
