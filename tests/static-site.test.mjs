import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('quote form posts to the OPP lead intake on pages.dev (no local /api, never the sod endpoint)', () => {
  const config = read('src/config.ts');
  assert.match(config, /LEAD_ENDPOINT = "https:\/\/orlando-pest-pros\.pages\.dev\/api\/quote"/);
  assert.doesNotMatch(config, /osceolasodsolutions\.top/);
  const form = read('src/components/QuoteForm.astro');
  assert.match(form, /action=\{LEAD_ENDPOINT\} method="POST"/);
  assert.doesNotMatch(form, /\/api\/quote/);
  for (const field of ['name="name"', 'name="phone"', 'name="service"', 'name="city"', 'name="message"', 'name="website"', 'name="form_started_at"', 'name="source_page"']) {
    assert.ok(form.includes(field), field);
  }
  assert.match(form, /Accept: "application\/json"/);
});

test('GitHub Pages: CNAME is the apex domain, no Vercel adapter or server routes', () => {
  assert.equal(read('public/CNAME').trim(), 'orlandopestcontrol.top');
  assert.doesNotMatch(read('astro.config.mjs'), /@astrojs\/vercel|adapter\s*:/);
  assert.equal(existsSync(new URL('../src/pages/api', import.meta.url)), false);
  assert.equal(existsSync(new URL('../vercel.json', import.meta.url)), false);
  assert.ok(existsSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url)));
});
