// Local test for the opp-store Worker — plain Node, no wrangler/miniflare.
//
// The fake KV binding intentionally implements ONLY get/put/delete.
// It has NO list() method: if the Worker ever called env.OPP_KV.list()
// this harness would crash with a TypeError — that is the proof of the
// zero-list-operations design the Cloudflare free tier requires.
//
// Run:  node test/local-test.mjs        (or: npm test)

import worker from '../src/index.js';

const SECRET = 'test-secret-for-local-harness';

class FakeKV {
  constructor() {
    this.store = new Map();
    this.putOpts = new Map();
    this.gets = 0;
    this.puts = 0;
  }
  async get(key) {
    this.gets++;
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async put(key, value, opts) {
    this.puts++;
    this.store.set(key, String(value));
    if (opts) this.putOpts.set(key, opts);
  }
  async delete(key) {
    this.store.delete(key);
  }
  // NOTE: no list() — on purpose.
}

const env = { OPP_KV: new FakeKV(), OPP_SHARED_SECRET: SECRET };
const BASE = 'https://opp-store.test';

function req(path, { method = 'GET', secret, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (secret !== undefined) headers['x-opp-key'] = secret;
  return new Request(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
  console.log('  ok —', label);
}

const call = (r) => worker.fetch(r, env);

// 1. Health is open.
let res = await call(req('/health'));
assert(res.status === 200 && (await res.json()).ok === true, 'GET /health -> 200 ok');

// 2. Auth gates everything else.
res = await call(req('/read'));
assert(res.status === 401, 'GET /read without secret -> 401');
res = await call(req('/read', { secret: 'wrong' }));
assert(res.status === 401, 'GET /read with wrong secret -> 401');
res = await call(req('/track', { method: 'POST', body: { t: 'pv', p: '/' } }));
assert(res.status === 401, 'POST /track without secret -> 401');

// 3. Pageviews count up in today's fixed day key.
res = await call(req('/track', { method: 'POST', secret: SECRET, body: { t: 'pv', p: '/locations/st-cloud/' } }));
let data = await res.json();
assert(res.status === 200 && data.counted === true, 'POST /track pv -> counted');
await call(req('/track', { method: 'POST', secret: SECRET, body: { t: 'pv', p: '/locations/st-cloud/' } }));
const todayKey = 'opp:day:' + new Date().toISOString().slice(0, 10);
const dayCounts = JSON.parse(env.OPP_KV.store.get(todayKey));
assert(dayCounts['/locations/st-cloud|pv'] === 2, 'day key holds pv count = 2');
assert(env.OPP_KV.putOpts.get(todayKey).expirationTtl === 35 * 24 * 60 * 60, 'day key written with 35-day TTL');

// 4. Conversion dedupe: same did twice counts once.
const did = '123e4567-e89b-12d3-a456-426614174000';
res = await call(req('/track', { method: 'POST', secret: SECRET, body: { t: 'tel', p: '/', did } }));
assert((await res.json()).counted === true, 'first tel with did -> counted');
res = await call(req('/track', { method: 'POST', secret: SECRET, body: { t: 'tel', p: '/', did } }));
assert((await res.json()).counted === false, 'same tel did again -> NOT counted (dedupe)');
assert(env.OPP_KV.putOpts.get('opp:dedup:' + did).expirationTtl === 300, 'dedup key written with 300s TTL');

// 5. Bad event type is refused.
res = await call(req('/track', { method: 'POST', secret: SECRET, body: { t: 'click', p: '/' } }));
assert(res.status === 400, 'POST /track bad type -> 400');

// 6. Leads append, newest first, no expiry.
const lead1 = { name: 'Test One', phone: '407-555-0101', service: 'General Pest Control', city: 'St. Cloud', message: '', source: '/', submittedAt: '2026-10-06T13:00:00.000Z' };
const lead2 = { name: 'Test Two', phone: '407-555-0102', service: 'Termite Control', city: 'Kissimmee', message: 'ants', source: '/get-a-quote/', submittedAt: '2026-10-06T14:00:00.000Z' };
res = await call(req('/lead', { method: 'POST', secret: SECRET, body: lead1 }));
assert(res.status === 200, 'POST /lead #1 -> 200');
res = await call(req('/lead', { method: 'POST', secret: SECRET, body: lead2 }));
assert(res.status === 200, 'POST /lead #2 -> 200');
assert(!env.OPP_KV.putOpts.has('opp:leads') || !env.OPP_KV.putOpts.get('opp:leads')?.expirationTtl, 'leads key written WITHOUT expiry');
res = await call(req('/lead', { method: 'POST', secret: SECRET, body: { name: 'X' } }));
assert(res.status === 400, 'POST /lead malformed -> 400');

// 7. Cap: pre-seed 1,000 leads, add one, still 1,000, newest first, oldest dropped.
const seeded = Array.from({ length: 1000 }, (_, i) => ({ name: 'Seed ' + i, phone: '407-555-0000', service: 's', city: 'c', message: '', source: '/', submittedAt: '2026-01-01T00:00:00.000Z' }));
env.OPP_KV.store.set('opp:leads', JSON.stringify(seeded));
await call(req('/lead', { method: 'POST', secret: SECRET, body: lead1 }));
const capped = JSON.parse(env.OPP_KV.store.get('opp:leads'));
assert(capped.length === 1000 && capped[0].name === 'Test One' && capped[999].name === 'Seed 998', 'leads capped at 1,000, newest first, oldest dropped');
// reset for the read test
env.OPP_KV.store.set('opp:leads', JSON.stringify([lead2, lead1]));

// 8. Read-back: the whole point of this Worker.
res = await call(req('/read?days=30', { secret: SECRET }));
data = await res.json();
const today = new Date().toISOString().slice(0, 10);
assert(res.status === 200 && data.ok === true, 'GET /read -> 200');
assert(data.days[today]['/locations/st-cloud|pv'] === 2, 'read returns today\'s counters');
assert(data.days[today]['/|tel'] === 1, 'read returns deduped tel count = 1');
assert(data.leadsTotal === 2 && data.leads[0].name === 'Test Two' && data.leads[1].name === 'Test One', 'read returns leads newest-first');

// 9. Unknown route.
res = await call(req('/nope', { secret: SECRET }));
assert(res.status === 404, 'unknown route -> 404');

console.log(`\nALL ${passed} ASSERTIONS PASSED — KV ops used: ${env.OPP_KV.gets} gets, ${env.OPP_KV.puts} puts, 0 lists (list does not exist on the fake).`);
