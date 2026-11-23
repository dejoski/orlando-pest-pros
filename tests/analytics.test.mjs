import test from 'node:test';
import assert from 'node:assert/strict';
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
