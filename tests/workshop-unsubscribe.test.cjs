const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { unsubscribeUrl, readUnsubscribeToken } = require('../api/_unsubscribe');

const env = { DATABASE_URL: 'test-database', RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'workshops@example.com' };
const email = 'jane@example.com';
const token = new URL(unsubscribeUrl(email, env)).searchParams.get('token');

function fixture(options = {}) {
  const sent = [];
  const queries = [];
  let exists = true;
  const context = {
    module: { exports: {} },
    process: { env: { ...env } },
    console: { error() {} },
    require(name) {
      if (name === '@neondatabase/serverless') return { neon() { return async (strings, ...values) => {
        queries.push({ query: strings.join('?'), values });
        if (options.databaseError) throw new Error('Database failed');
        const rows = exists ? [{ email }] : [];
        exists = false;
        return rows;
      }; } };
      if (name === 'crypto') return require('node:crypto');
      if (name === './_email') return require('../api/_email');
      if (name === './_unsubscribe') return {
        readUnsubscribeToken(value) { return readUnsubscribeToken(value, context.process.env); },
      };
      if (name === 'resend') return { Resend: class {
        emails = { send: async (message, options) => {
          sent.push({ message, options });
          return { error: options.sendError || null };
        } };
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/workshop-unsubscribe'), 'utf8'), context);
  return { sent, queries, env: context.process.env, async request(value = token, method = 'GET') {
    const res = {
      headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.code = code; return this; },
      send(html) { this.html = html; return this; },
    };
    await context.module.exports({ method, query: { token: value }, body: { token: value } }, res);
    return res;
  } };
}

test('unsubscribe links identify the subscriber and reject tampering or another signing key', () => {
  assert.equal(readUnsubscribeToken(token, env), email);
  const forged = `${Buffer.from('other@example.com').toString('base64url')}.${token.split('.')[1]}`;
  assert.equal(readUnsubscribeToken(forged, env), null);
  assert.equal(readUnsubscribeToken(token, { RESEND_API_KEY: 'different' }), null);
  for (const invalid of ['', 'invalid', [], 'x'.repeat(1025)]) {
    assert.equal(readUnsubscribeToken(invalid, env), null);
  }
});

test('opening the email link only renders the confirmation form', async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.code, 200);
  assert.match(response.html, /Want to unsubscribe/);
  assert.match(response.html, /method="POST" action="\/unsubscribe"/);
  assert.match(response.html, /Confirm unsubscribe/);
  assert.equal(f.queries.length, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
});

test('confirming deletes only the signed email and notifies Tamara', async () => {
  const f = fixture();
  const response = await f.request(token, 'POST');
  assert.equal(response.code, 200);
  assert.match(response.html, /You’re unsubscribed/);
  assert.equal(f.queries.length, 1);
  assert.match(f.queries[0].query, /^DELETE FROM workshop_signups WHERE email = \? RETURNING email$/);
  assert.equal(f.queries[0].values[0], email);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].message.to[0], 'codewithtamara@gmail.com');
  assert.equal(f.sent[0].message.replyTo, email);
  assert.match(f.sent[0].message.text, /signup has been deleted/);
  assert.match(f.sent[0].message.text, /No manual removal is needed/);
});

test('repeated confirmation succeeds without another notification', async () => {
  const f = fixture();
  await f.request(token, 'POST');
  assert.equal((await f.request(token, 'POST')).code, 200);
  assert.equal(f.sent.length, 1);
});

test('invalid tokens and unsupported methods never touch Neon or send email', async () => {
  const f = fixture();
  assert.equal((await f.request('bad')).code, 400);
  assert.equal((await f.request('bad', 'POST')).code, 400);
  assert.equal((await f.request(token, 'PUT')).code, 405);
  assert.equal(f.queries.length, 0);
  assert.equal(f.sent.length, 0);
});

test('database failure never claims a successful unsubscribe or sends a notification', async () => {
  const f = fixture({ databaseError: true });
  const response = await f.request(token, 'POST');
  assert.equal(response.code, 502);
  assert.match(response.html, /couldn’t unsubscribe you yet/);
  assert.equal(f.sent.length, 0);
});

test('a notification failure does not undo deletion or show an unsubscribe error', async () => {
  const f = fixture({ sendError: { message: 'send failed' } });
  const response = await f.request(token, 'POST');
  assert.equal(response.code, 200);
  assert.match(response.html, /You’re unsubscribed/);
  assert.equal(f.queries.length, 1);
});

test('missing database configuration blocks deletion and asks the visitor to retry', async () => {
  const f = fixture();
  delete f.env.DATABASE_URL;
  assert.equal((await f.request(token, 'POST')).code, 503);
  assert.equal(f.queries.length, 0);
  assert.equal(f.sent.length, 0);
});
