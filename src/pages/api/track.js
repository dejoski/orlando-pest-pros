export const prerender = false;
// src/pages/api/track.js — first-party analytics collector (Astro API route).
//
// Copy this file to `src/pages/api/track.js` in the site. Zero npm dependencies:
// it talks to Upstash Redis (Vercel KV) over the plain REST API with fetch.
//
// Env vars (auto-attached when the KV database is connected to the project,
// see SETUP.md). Either pair works:
//   KV_REST_API_URL / KV_REST_API_TOKEN                (Vercel KV)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Upstash via Marketplace)
// If none are set the endpoint no-ops with 204 — the site keeps working.
//
// Storage schema (see TRACKING.md): one Redis hash per day,
//   key:   opp:day:YYYY-MM-DD        (TTL 35 days, UTC)
//   field: {page}|{event}  -> count  (HINCRBY, atomic)

const ALLOWED_TYPES = new Set(['pv', 'tel', 'form_start', 'form_submit']);

// Obvious bots/crawlers/scrapers — never count them.
const BOT_RE =
  /bot|crawl|spider|slurp|mediapartners|baiduspider|yandex|duckduckbot|bingpreview|headless|phantomjs|puppeteer|selenium|playwright|facebookexternalhit|twitterbot|linkedinbot|embedly|quora|slackbot|telegrambot|whatsapp|discordbot|ahrefs|semrush|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|uptimerobot|pingdom/i;

// Keep 35 days of daily hashes (dashboard shows 30) so storage stays bounded.
const TTL_SECONDS = 35 * 24 * 60 * 60;
const DEDUP_TTL_SECONDS = 300;

function kvConfig() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { base: url.replace(/\/+$/, ''), token };
}

// One HTTP round-trip for N Redis commands. Returns the Upstash result array
// ([{result: ...}, ...]) or null when KV isn't configured.
// NOTE: each command in a pipeline still counts toward the free-tier quota.
async function pipeline(commands) {
  const cfg = kvConfig();
  if (!cfg) return null;
  const res = await fetch(cfg.base + '/pipeline', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });
  if (!res.ok) throw new Error('kv pipeline failed: ' + res.status);
  return res.json();
}

// Allowlist-style cleanup of the reported page path.
function cleanPage(p) {
  var s = String(p || '/').slice(0, 120).toLowerCase();
  s = s.replace(/[^a-z0-9/_-]/g, '').replace(/\/+$/, '');
  return s || '/';
}

function validDid(d) {
  return /^[0-9a-f-]{8,36}$/i.test(String(d || ''));
}

export async function POST({ request }) {
  try {
    // Server-side bot filter (authoritative; client also skips bots).
    const ua = request.headers.get('user-agent') || '';
    if (!ua || ua.length > 300 || BOT_RE.test(ua)) {
      return new Response(null, { status: 204 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }

    const type = String(body.t || '');
    if (!ALLOWED_TYPES.has(type)) return new Response(null, { status: 400 });
    const page = cleanPage(body.p);
    const day = 'opp:day:' + new Date().toISOString().slice(0, 10); // UTC, server-side

    const cfg = kvConfig();
    if (cfg) {
      // Server-side dedupe for conversion events: client sends a UUID per
      // interaction; if we've seen it in the last 5 min, count nothing.
      // (pageviews skip this to save 1 command — client-side dedupe covers them.)
      if ((type === 'tel' || type === 'form_submit') && validDid(body.did)) {
        const r = await pipeline([
          ['SET', 'opp:dedup:' + body.did, '1', 'NX', 'EX', DEDUP_TTL_SECONDS]
        ]);
        // Upstash returns result: null when the key already existed.
        if (r && r[0] && r[0].result === null) {
          return new Response(null, { status: 204 });
        }
      }

      // 2 commands per event, 1 HTTP round-trip. HINCRBY is atomic.
      await pipeline([
        ['HINCRBY', day, page + '|' + type, 1],
        ['EXPIRE', day, TTL_SECONDS]
      ]);
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    // Fails open: analytics must never break the site or show errors to visitors.
    console.error('[analytics/track]', err);
    return new Response(null, { status: 204 });
  }
}
