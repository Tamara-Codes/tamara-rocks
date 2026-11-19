const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../api/workshop-feedback.js'), 'utf8');
const valid = { takeaway: '  Context finally makes sense.  ', publicationPermission: 'private' };

function fixture(options = {}) {
    const activity = { connected: 0, queries: [], logs: [] };
    const context = {
        module: { exports: {} }, Buffer,
        console: { error(message) { activity.logs.push(message); } },
        process: { env: { DATABASE_URL: 'test-only', ...options.env } },
        require(name) {
            if (name === 'node:crypto') return require(name);
            if (name === '@neondatabase/serverless') return { neon() {
                activity.connected++;
                return async (strings, ...values) => {
                    const query = strings.join('?');
                    activity.queries.push({ query, values });
                    if (options.databaseError || (options.insertError && query.includes('INSERT INTO workshop_feedback ('))) throw new Error('private connection details');
                    return query.includes('rate_limits') ? [{ attempts: options.attempts || 1 }] : [];
                };
            } };
            throw new Error(`Unexpected dependency: ${name}`);
        },
    };
    vm.runInNewContext(source, context);
    return { activity, async request(body = valid, method = 'POST', headers = {}) {
        const response = {
            headers: {}, setHeader(name, value) { this.headers[name] = value; },
            status(code) { this.code = code; return this; },
            json(body) { this.body = body; return this; },
        };
        await context.module.exports({ method, body, headers: { 'x-forwarded-for': '192.0.2.1', ...headers } }, response);
        return response;
    } };
}

test('all permission choices are stored exactly with server-owned workshop and review status', async () => {
    for (const choice of ['private', 'anonymous', 'named']) {
        const f = fixture();
        const res = await f.request({ ...valid, firstName: '  Ana  ', publicationPermission: choice,
            workshop_slug: 'paid-workshop', review_status: 'published', permission_version: 'forged' });
        assert.equal(res.code, 200);
        assert.equal(res.body.ok, true);
        const insert = f.activity.queries[1];
        assert.equal(insert.values[0], 'ai-demystified-free');
        assert.equal(insert.values[1], 'Context finally makes sense.');
        assert.equal(insert.values[2], '');
        assert.equal(insert.values[3], 'Ana');
        assert.equal(insert.values[4], choice);
        assert.equal(insert.values[5], '2026-11-19-v1');
        assert.match(insert.values[6], /workshop promotional materials/);
        assert.match(insert.query, /NOW\(\), 'unreviewed'/);
        assert.equal(insert.values.includes('published'), false);
        assert.equal(insert.values.includes('paid-workshop'), false);
        assert.equal(res.body.takeaway, undefined);
        assert.equal(res.headers['Cache-Control'], 'no-store');
    }
});

test('private or anonymous feedback does not need a name; named quotes do', async () => {
    for (const permission of ['private', 'anonymous']) {
        assert.equal((await fixture().request({ ...valid, publicationPermission: permission })).code, 200);
    }
    const f = fixture();
    assert.equal((await f.request({ ...valid, firstName: '  ', publicationPermission: 'named' })).code, 400);
    assert.equal(f.activity.connected, 0);
});

test('missing, forged, type-confused and oversized fields are rejected before storage', async () => {
    const invalid = [null, [], {}, { ...valid, takeaway: ' ' }, { ...valid, takeaway: 123 },
        { ...valid, takeaway: 'x'.repeat(2001) }, { ...valid, improvement: 'x'.repeat(2001) },
        { ...valid, improvement: {} }, { ...valid, firstName: 'x'.repeat(81) },
        { ...valid, firstName: [] }, { ...valid, publicationPermission: undefined },
        { ...valid, publicationPermission: 'yes' }, { ...valid, publicationPermission: ['named'], firstName: 'Ana' }];
    for (const body of invalid) {
        const f = fixture();
        assert.equal((await f.request(body)).code, 400);
        assert.equal(f.activity.connected, 0);
    }
    const f = fixture();
    assert.equal((await f.request({ ...valid, extra: 'x'.repeat(33000) })).code, 413);
    assert.equal(f.activity.connected, 0);
});

test('public reads, foreign browser origins and honeypots never access feedback storage', async () => {
    const f = fixture();
    for (const method of ['GET', 'PUT', 'DELETE']) {
        const result = await f.request(valid, method);
        assert.equal(result.code, 405);
        assert.equal(result.headers.Allow, 'POST');
    }
    assert.equal((await f.request(valid, 'POST', { origin: 'https://other.example' })).code, 403);
    assert.equal((await f.request({ ...valid, _honey: 'spam' })).code, 200);
    assert.equal(f.activity.connected, 0);
    assert.equal((await fixture().request(valid, 'POST', { origin: 'https://www.tamara.rocks' })).code, 200);
});

test('rate limits stop inserts and retain only a hashed network identifier', async () => {
    const f = fixture({ attempts: 6 });
    assert.equal((await f.request()).code, 429);
    assert.equal(f.activity.queries.length, 1);
    const key = f.activity.queries[0].values[0];
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(key.includes('192.0.2.1'), false);
});

test('missing storage and failed inserts never report success or log personal data', async () => {
    assert.equal((await fixture({ env: { DATABASE_URL: '' } }).request()).code, 503);
    for (const failure of [{ databaseError: true }, { insertError: true }]) {
        const f = fixture(failure);
        const result = await f.request();
        assert.equal(result.code, 500);
        assert.equal(result.body.ok, undefined);
        assert.deepEqual(f.activity.logs, ['Workshop feedback could not be saved.']);
        assert.equal(JSON.stringify(result.body).includes('private connection details'), false);
    }
});
