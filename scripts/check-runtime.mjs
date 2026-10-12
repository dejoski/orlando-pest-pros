import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

// Public marketing pages must stay prerendered. Runtime expansion needs an
// explicit update to this reviewed allowlist rather than an unnoticed deploy.
const allowed = new Set(['src/pages/api/quote.ts', 'src/pages/dash-v9x4qm2k.astro']);
const actual = new Set();
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(?:astro|[cm]?[jt]s)$/.test(path) && /export\s+const\s+prerender\s*=\s*false/.test(readFileSync(path, 'utf8'))) actual.add(relative('.', path).replaceAll('\\', '/'));
  }
}
walk('src/pages');
assert.deepEqual([...actual].sort(), [...allowed].sort(), 'Unexpected dynamic routes: review CPU exposure before deployment');
assert.equal(existsSync('src/pages/api/track.js'), false, 'Browser analytics must not restore a Vercel function');
for (const path of ['src/middleware.ts', 'src/middleware.js']) assert.equal(existsSync(path), false, 'Global runtime middleware requires CPU review');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
assert.equal((config.crons ?? []).length, 0, 'Cron must not be enabled without CPU review');
console.log('Runtime guard passed: public pages static; quote and private dashboard only; no cron or global middleware.');
