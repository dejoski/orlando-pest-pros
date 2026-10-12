import test from 'node:test';
import assert from 'node:assert/strict';
import { trackAcceptedLead } from '../src/lib/analytics.js';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

test('public attribution sends no network requests and has no function route', () => {
  const script = readFileSync(new URL('../public/track.js', import.meta.url), 'utf8');
  const context = {location: {pathname: '/locations/kissimmee/', hostname: 'example.com', search: ''}, document: {referrer: 'https://www.google.com/search?q=private'}, window: {}, sessionStorage: {getItem: () => null, setItem: () => {}}, URL, URLSearchParams, fetch: () => {throw new Error('Network request forbidden');}, navigator: {sendBeacon: () => {throw new Error('Beacon forbidden');}}};
  vm.runInNewContext(script, context);
  assert.equal(context.window.oppAttribution().channel, 'organic');
  assert.equal(context.window.oppAttribution().referrer, 'google');
  assert.equal(existsSync(new URL('../src/pages/api/track.js', import.meta.url)), false);
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
