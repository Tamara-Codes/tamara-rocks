const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../api/workshop-signup.js'), 'utf8');

function fixture(options = {}) {
  const queries = [], pending = [], sent = [], errors = [];
  let saved = false;
  const context = {
    module: { exports: {} },
    process: { env: {
      DATABASE_URL: 'test-database', RESEND_API_KEY: 'test-key',
      RESEND_FROM_EMAIL: 'workshops@example.com',
    } },
    console: { error(...args) { errors.push(args); } },
    require(name) {
      if (name === 'crypto') return require('node:crypto');
      if (name === './_email') return require('../api/_email');
      if (name === './_unsubscribe') return require('../api/_unsubscribe');
      if (name === '@vercel/functions') return { waitUntil(promise) { pending.push(promise); } };
      if (name === '@neondatabase/serverless') return { neon() {
        return async (strings, ...values) => {
          queries.push({ query: strings.join('?'), values });
          if (options.databaseError) throw new Error('Database unavailable');
          saved = !options.existing && !options.ipBlocked && !options.emailBlocked;
          return [{ ip_allowed: !options.ipBlocked, email_allowed: !options.emailBlocked, inserted: saved }];
        };
      } };
      if (name === 'resend') return { Resend: class {
        emails = { send: async (message) => {
          assert.equal(saved, true, 'email must start only after the signup is saved');
          sent.push(message);
          return options.delivery ? options.delivery : { error: options.sendError || null };
        } };
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  return { queries, pending, sent, errors, async request(email = 'jane@example.com') {
    const res = {
      setHeader() {}, status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await context.module.exports({ method: 'POST', headers: { 'x-forwarded-for': '192.0.2.1' }, body: { email } }, res);
    return res;
  } };
}

test('responds after one database call while email delivery is still pending', { timeout: 2000 }, async () => {
  let finishDelivery;
  const delivery = new Promise(resolve => { finishDelivery = resolve; });
  const f = fixture({ delivery });
  try {
    const res = await f.request();
    assert.equal(res.code, 200);
    assert.equal(res.body.ok, true);
    assert.equal(f.queries.length, 1);
    assert.doesNotMatch(f.queries[0].query, /CREATE TABLE|DELETE FROM/);
    assert.equal(f.pending.length, 1, 'Vercel must keep the email task alive');
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0].html, /19 November 2026/);
    assert.match(f.sent[0].html, /unsubscribe\?token=/);
  } finally {
    finishDelivery({ error: null });
    await Promise.all(f.pending);
  }
});

test('email failure is handled without removing a saved registration', async () => {
  const f = fixture({ sendError: { message: 'Provider unavailable' } });
  assert.equal((await f.request()).code, 200);
  await Promise.all(f.pending);
  assert.equal(f.errors.length, 1);
  assert.equal(f.queries.length, 1);
});

test('database failure cannot show success or queue a confirmation email', async () => {
  const f = fixture({ databaseError: true });
  assert.equal((await f.request()).code, 500);
  assert.equal(f.pending.length, 0);
  assert.equal(f.sent.length, 0);
});

test('existing signup succeeds without sending another email', async () => {
  const f = fixture({ existing: true });
  const res = await f.request();
  assert.equal(res.code, 200);
  assert.equal(res.body.alreadyRegistered, true);
  assert.equal(f.pending.length, 0);
});

test('either exceeded rate limit prevents success and email delivery', async () => {
  for (const options of [{ ipBlocked: true }, { emailBlocked: true }]) {
    const f = fixture(options);
    assert.equal((await f.request()).code, 429);
    assert.equal(f.pending.length, 0);
    assert.equal(f.sent.length, 0);
  }
});

test('invalid addresses are rejected before any database call', async () => {
  const f = fixture();
  assert.equal((await f.request('invalid')).code, 400);
  assert.equal(f.queries.length, 0);
});

function formFixture() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = html.match(/<script>\s*\/\/ ── Course waitlists[\s\S]*?<\/script>/)[0]
    .replace(/^<script>|<\/script>$/g, '');
  const events = {}, attrs = {}, alerts = [];
  const button = {
    textContent: 'Save my spot', disabled: false,
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
  };
  const success = { shown: false, classList: { add() { success.shown = true; } } };
  const form = {
    action: '/api/workshop-signup', style: {},
    elements: { email: { value: 'jane@example.com', addEventListener() {} }, _honey: { value: '' } },
    parentElement: { querySelector() { return success; } },
    querySelector() { return button; }, addEventListener(name, handler) { events[name] = handler; },
  };
  let respond;
  const request = new Promise(resolve => { respond = resolve; });
  vm.runInNewContext(script, {
    document: { querySelectorAll() { return [form]; } },
    window: {}, fetch() { return request; }, trackWorkshopEvent() {},
    alert(message) { alerts.push(message); },
  });
  return { button, success, form, attrs, alerts, respond, submit() { events.submit({ preventDefault() {} }); } };
}

test('form immediately shows saving and waits for server success before thanking the visitor', async () => {
  const f = formFixture();
  f.submit();
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.textContent, 'Saving your spot…');
  assert.equal(f.attrs['aria-busy'], 'true');
  assert.equal(f.success.shown, false);
  f.respond({ ok: true, json: async () => ({ ok: true }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.success.shown, true);
  assert.equal(f.form.style.display, 'none');
  assert.equal(f.attrs['aria-busy'], undefined);
});

test('failed signup restores the button and keeps the form available to retry', async () => {
  const f = formFixture();
  f.submit();
  f.respond({ ok: false, json: async () => ({ error: 'Please try again.' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.success.shown, false);
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, 'Save my spot');
  assert.equal(f.attrs['aria-busy'], undefined);
  assert.equal(f.alerts[0], 'Please try again.');
});
