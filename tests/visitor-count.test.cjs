const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../api/visitor-count.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(__dirname, '../visitor-counter.js'), 'utf8');

function fixture({ missingUrl = false, fail = false } = {}) {
  const queries = [];
  let connections = 0;
  const context = {
    module: { exports: {} },
    process: { env: missingUrl ? {} : { DATABASE_URL: 'test-only' } },
    console: { error() {} },
    require(name) {
      assert.equal(name, '@neondatabase/serverless');
      return { neon() {
        connections++;
        return async (strings, ...values) => {
          queries.push({ text: strings.join('?'), values });
          if (fail) throw new Error('test failure');
          return [{ visits: '162' }];
        };
      } };
    },
  };
  vm.runInNewContext(source, context);
  return {
    queries,
    get connections() { return connections; },
    async request(method, cookie = '') {
      const res = {
        headers: {}, code: null, body: null,
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
        end() { return this; },
      };
      await context.module.exports({ method, headers: { cookie, 'x-forwarded-proto': 'https' } }, res);
      return res;
    },
  };
}

test('GET is a shared cacheable read regardless of visitor cookie', async () => {
  for (const cookie of ['', 'tamara_rocks_visitor=1']) {
    const f = fixture();
    const res = await f.request('GET', cookie);
    assert.equal(res.code, 200);
    assert.equal(res.body.visits, 162);
    assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'public, s-maxage=3600');
    assert.equal(res.headers['Cache-Control'], 'public, max-age=60');
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.equal(f.queries.length, 1);
    assert.match(f.queries[0].text, /^SELECT/);
  }
});

test('new visitor increments atomically once and the response cannot be cached', async () => {
  const f = fixture();
  const res = await f.request('POST', 'other_cookie=1');
  assert.equal(res.code, 200);
  assert.equal(f.queries.length, 1);
  assert.match(f.queries[0].text, /ON CONFLICT \(name\) DO UPDATE SET visits = site_counters.visits \+ 1/);
  assert.doesNotMatch(f.queries[0].text, /CREATE TABLE/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
  assert.match(res.headers['Set-Cookie'], /tamara_rocks_visitor=1;.*SameSite=Lax; Secure/);
});

test('repeat registration returns 204 without even connecting to Neon', async () => {
  const f = fixture();
  const res = await f.request('POST', 'other=1; tamara_rocks_visitor=1');
  assert.equal(res.code, 204);
  assert.equal(f.connections, 0);
  assert.equal(res.headers['Set-Cookie'], undefined);
  assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
});

test('errors and unsupported methods cannot enter the CDN cache', async () => {
  for (const [options, method, status] of [[{ missingUrl: true }, 'GET', 503], [{ fail: true }, 'GET', 500], [{}, 'DELETE', 405]]) {
    const f = fixture(options);
    const res = await f.request(method);
    assert.equal(res.code, status);
    assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
    assert.equal(res.headers['Set-Cookie'], undefined);
  }
});

async function runClient(cookie, responses) {
  const requests = [];
  const output = { textContent: '', classList: { add() {} } };
  vm.runInNewContext(clientSource, {
    document: { cookie, getElementById() { return output; } },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET' });
      const status = responses.shift();
      return { status, ok: status >= 200 && status < 300, json: async () => ({ visits: 162 }) };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { requests, output };
}

test('browser registers new visitors and only reads for returning visitors', async () => {
  const first = await runClient('', [200]);
  assert.equal(first.requests[0].method, 'POST');
  assert.equal(first.output.textContent, '000162');
  const returning = await runClient('tamara_rocks_visitor=1', [200]);
  assert.equal(returning.requests[0].method, 'GET');
  assert.equal(returning.output.textContent, '000162');
});

test('browser handles registration in another tab by reading the cached total', async () => {
  const result = await runClient('', [204, 200]);
  assert.deepEqual(result.requests.map(r => r.method), ['POST', 'GET']);
  assert.equal(result.output.textContent, '000162');
});
