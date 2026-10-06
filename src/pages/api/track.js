export const prerender = false;
// src/pages/api/track.js — first-party analytics collector (Astro API route).
//
// Copy this file to `src/pages/api/track.js` in the site. Zero npm dependencies:
// storage is plain fetch calls, no SDKs.
//
// STORAGE ROUTING (2026-10-06): events go to the Cloudflare "opp-store"
// Worker FIRST (src/lib/cf-store.ts) because the Vercel KV below was
// never connected — its env vars can't be set from our automation (the
// Vercel dashboard sign-in demands a GitHub password re-entry). The
// Worker's URL + secret are committed in the repo, so the git deploy
// is the only "setup" it needs. If the Worker is unconfigured or a
// write fails, the code falls back to the original KV path below, and
// if that isn't configured either, it logs a loud console.error per
// event — dropped analytics must be VISIBLE in the function logs,
// never a silent no-op. Bot filtering (below) happens BEFORE either
// store is touched and is unchanged.
//
// Storage schema (see TRACKING.md): one hash per day in KV / one JSON
// object per day in the Worker, both shaped the same:
//   key:   opp:day:YYYY-MM-DD        (TTL 35 days, UTC)
//   field: {page}|{event}  -> count  (HINCRBY in KV, atomic there;
//          read-modify-write in the Worker — fine at this volume)

import { cfStoreConfigured, cfStoreTrack } from '../../lib/cf-store';

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

    // Primary store: the Cloudflare Worker. It performs the same
    // conversion-event dedupe server-side (did + 5-minute window) and
    // increments the same day schema. Any failure falls through to
    // the KV path below — the Worker being down must not lose events
    // that KV could have taken, and must never break the beacon.
    if (cfStoreConfigured()) {
      const stored = await cfStoreTrack({
        t: type,
        p: page,
        did: validDid(body.did) ? String(body.did) : undefined
      });
      if (stored) return new Response(null, { status: 204 });
      console.error(
        '[analytics/track] WARNING: Cloudflare store write failed for ' +
          type + ' event on ' + page + ' — falling back to KV store'
      );
    }

    const cfg = kvConfig();
    if (!cfg) {
      // No store took this event: it is being DROPPED. The client
      // still gets its normal 204, but the data loss is logged loudly
      // so an unconfigured store shows up in the function logs
      // immediately instead of silently eating analytics.
      console.error(
        '[analytics/track] WARNING: no analytics store available — dropping ' +
          type + ' event for ' + page +
          ' (Cloudflare store unconfigured/failed and KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_* pair unset)'
      );
    } else {
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
