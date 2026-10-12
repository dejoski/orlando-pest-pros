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
// If none are set the endpoint still returns 204 (the site keeps working)
// but logs a loud console.error per event — dropped analytics must be
// VISIBLE in the function logs, never a silent no-op.
//
// Storage schema (see TRACKING.md): one Redis hash per day,
//   key:   opp:day:YYYY-MM-DD        (TTL 35 days, UTC)
//   field: {page}|{event}  -> count  (HINCRBY, atomic)

const ALLOWED_TYPES = new Set(['pv', 'tel', 'form_start']);

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
  const results = await res.json();
  if (!Array.isArray(results) || results.length !== commands.length || results.some(r => !r || r.error)) throw new Error('kv command failed');
  return results;
}

// Allowlist-style cleanup of the reported page path.
function cleanPage(p) {
  var s = String(p || '/').split(/[?#]/)[0].slice(0, 120).toLowerCase();
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
      const raw = await request.text();
      if (raw.length > 2048) return new Response(null, { status: 413 });
      body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response(null, { status: 400 });
    } catch {
      return new Response(null, { status: 400 });
    }

    const type = String(body.t || '');
    if (!ALLOWED_TYPES.has(type)) return new Response(null, { status: 400 });
    const page = cleanPage(body.p);
    if (/^\/(?:dash-|api\/)/.test(page)) return new Response(null, { status: 204 });
    const channel = ['organic', 'paid', 'referral', 'direct'].includes(body.channel) ? body.channel : 'unknown';
    const day = 'opp:day:' + new Date().toISOString().slice(0, 10); // UTC, server-side

    const cfg = kvConfig();
    if (!cfg) {
      // Storage not configured: this event is being DROPPED. The client
      // still gets its normal 204, but the data loss is logged loudly so
      // a missing KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_* pair)
      // in the Vercel project shows up in the function logs immediately.
      console.error(
        '[analytics/track] WARNING: KV storage not configured — dropping ' +
          type + ' event for ' + page +
          ' (set KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)'
      );
    } else {
      // Server-side dedupe for phone-click events: client sends a UUID per
      // interaction; if we've seen it in the last 5 min, count nothing.
      // (pageviews skip this to save 1 command — client-side dedupe covers them.)
      if (type === 'tel' && validDid(body.did)) {
        const r = await pipeline([
          ['SET', 'opp:dedup:' + body.did, '1', 'NX', 'EX', DEDUP_TTL_SECONDS]
        ]);
        // Upstash returns result: null when the key already existed.
        if (r && r[0] && r[0].result === null) {
          return new Response(null, { status: 204 });
        }
      }

      // 3 commands per event, 1 HTTP round-trip. HINCRBY is atomic.
      await pipeline([
        ['HINCRBY', day, page + '|' + type, 1],
        ['HINCRBY', day, '@' + channel + '|' + type, 1],
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


// Called only by the quote route after durable lead acceptance. Analytics
// failure must never change the outcome of an already persisted lead.
export async function trackAcceptedLead(lead) {
  try {
    if (!kvConfig()) return;
    const day = 'opp:day:' + new Date().toISOString().slice(0, 10);
    const channel = ['organic', 'paid', 'referral', 'direct'].includes(lead.attribution?.channel) ? lead.attribution.channel : 'unknown';
    await pipeline([
      ['HINCRBY', day, cleanPage(lead.source) + '|form_success', 1],
      ['HINCRBY', day, '@' + channel + '|form_success', 1],
      ['EXPIRE', day, TTL_SECONDS]
    ]);
  } catch (err) {
    console.error('[analytics/accepted-lead] Counter unavailable');
  }
}
