import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Compile the real handlers without running a server or needing Redis credentials.
const temp = await mkdtemp(join(tmpdir(), 'opp-leads-'));
let source = await readFile(new URL('../src/lib/leads.ts', import.meta.url), 'utf8');
for (const dataset of ['cities', 'services']) {
  const data = await readFile(new URL(`../src/data/${dataset}.json`, import.meta.url), 'utf8');
  source = source.replace(`import ${dataset} from "../data/${dataset}.json";`, `const ${dataset} = ${data};`);
}
await writeFile(join(temp, 'leads.mjs'), stripTypeScriptTypes(source));
let route = await readFile(new URL('../src/pages/api/quote.ts', import.meta.url), 'utf8');
route = route.replace('import { trackAcceptedLead } from "../../lib/analytics.js";', 'const trackAcceptedLead = async () => {};');
route = route.replace('"../../lib/leads"', '"./leads.mjs"');
await writeFile(join(temp, 'quote.mjs'), stripTypeScriptTypes(route));
const { validateLead, storeLead } = await import(pathToFileURL(join(temp, 'leads.mjs')));
const { POST } = await import(pathToFileURL(join(temp, 'quote.mjs')));
const originalFetch = globalThis.fetch;
const keys = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
const saved = keys.map(k => process.env[k]);
after(async () => { globalThis.fetch = originalFetch; keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]); await rm(temp, { recursive: true }); });
const valid = { name: 'Test Visitor', phone: '4075550199', city: 'Kissimmee', service: 'General Pest Control', source: '/' };
const send = (body, headers = {}) => POST({ request: new Request('https://example.com/api/quote', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }) });
function configure() { keys.forEach(k => delete process.env[k]); process.env.KV_REST_API_URL = 'https://redis.example'; process.env.KV_REST_API_TOKEN = 'test-token'; }

test('validation bounds fields and rejects malformed choices/phone/source', () => {
  assert.ok(validateLead(valid).lead);
  for (const input of [null, [], {}, { ...valid, name: 'a'.repeat(101) }, { ...valid, phone: '-------' }, { ...valid, city: 'Unknown' }, { ...valid, service: 'Unknown' }, { ...valid, message: 'x'.repeat(1001) }, { ...valid, source: '//evil.test' }, { ...valid, website: 'spam' }]) assert.ok(validateLead(input).error);
  assert.deepEqual(validateLead({ ...valid, attribution: { channel: 'organic', unknown: 'bad' } }).lead.attribution, { channel: 'organic' });
});
test('missing config never produces a successful submission', async () => {
  keys.forEach(k => delete process.env[k]);
  await assert.rejects(storeLead(validateLead(valid).lead));
  assert.equal((await send(valid)).status, 503);
});
test('HTTP and per-command Redis failures never return success', async () => {
  configure();
  for (const response of [new Response('', { status: 500 }), Response.json([{ error: 'WRONGTYPE' }, { result: 'OK' }]), Response.json([{ result: 1 }, { error: 'ERR' }]), Response.json([]), Response.json({ result: 'OK' })]) {
    globalThis.fetch = async () => response;
    assert.equal((await send(valid)).status, 503);
  }
});
test('confirmed persistence returns success and includes attribution without logs', async () => {
  configure();
  let commands;
  globalThis.fetch = async (_, options) => { commands = JSON.parse(options.body); return Response.json([{ result: 1 }, { result: 'OK' }]); };
  const response = await send({ ...valid, attribution: { channel: 'organic', landingPage: '/locations/kissimmee/' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(commands[0][0], 'LPUSH');
  assert.equal(JSON.parse(commands[0][2]).attribution.channel, 'organic');
});
test('request handler rejects cross-origin, oversized and malformed requests', async () => {
  assert.equal((await send(valid, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await send('x'.repeat(8193))).status, 413);
  assert.equal((await send('null')).status, 400);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send(valid, { 'content-type': 'text/plain' })).status, 415);
});
