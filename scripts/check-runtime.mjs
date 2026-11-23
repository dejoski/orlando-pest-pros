import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

// The site is fully static (GitHub Pages). Every page must prerender; there
// is no server runtime. Leads post cross-origin to the owner's Worker.
const dynamic = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(?:astro|[cm]?[jt]s)$/.test(path) && /export\s+const\s+prerender\s*=\s*false/.test(readFileSync(path, 'utf8'))) dynamic.push(relative('.', path).replaceAll('\\', '/'));
  }
}
walk('src/pages');
assert.deepEqual(dynamic, [], 'Static hosting: no dynamic routes allowed');
assert.equal(existsSync('src/pages/api'), false, 'Static hosting: no /api routes');
for (const path of ['src/middleware.ts', 'src/middleware.js']) assert.equal(existsSync(path), false, 'Static hosting: no middleware');
console.log('Runtime guard passed: every page is static; no API routes or middleware.');
