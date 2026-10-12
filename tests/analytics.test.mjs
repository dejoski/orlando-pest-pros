import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, trackAcceptedLead } from '../src/pages/api/track.js';

const request = body => new Request('https://example.com/api/track', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify(body) });
test('collector rejects client conversion claims and oversized input', async () => {
  assert.equal((await POST({ request: request({ t: 'form_success' }) })).status, 400);
  assert.equal((await POST({ request: request({ t: 'form_submit' }) })).status, 400);
  assert.equal((await POST({ request: request({ t: 'pv', junk: 'x'.repeat(3000) }) })).status, 413);
  assert.equal((await POST({ request: request(null) })).status, 400);
});
test('accepted lead counts use bounded source attribution and strip query data', async () => {
  process.env.KV_REST_API_URL = 'https://example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  const original = globalThis.fetch;
  let commands;
  globalThis.fetch = async (_url, options) => {
    commands = JSON.parse(options.body);
    return { ok: true, json: async () => commands.map(() => ({ result: 1 })) };
  };
  try {
    await trackAcceptedLead({ source: '/ants/?email=private@example.com', attribution: { channel: 'organic' } });
    assert.equal(commands[0][2], '/ants|form_success');
    assert.equal(commands[1][2], '@organic|form_success');
    assert.equal(commands[2][0], 'EXPIRE');
    // Redis command errors must be caught: the accepted lead remains accepted.
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ error: 'readonly' }] });
    await assert.doesNotReject(trackAcceptedLead({ source: '/' }));
  } finally {
    globalThis.fetch = original;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
});
