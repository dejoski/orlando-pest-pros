// functions/api/track.js — Cloudflare Pages Function port of
// src/pages/api/track.js (first-party analytics collector).
//
// This exists so the endpoint also runs when the site is deployed via
// the Cloudflare Pages dashboard Direct Upload flow, where the Astro
// build's dist/_worker.js directory is NOT activated (only Pages
// Functions are). The Astro route remains the wrangler-deploy path;
// keep the two implementations in sync.
//
// Storage: the KV namespace bound as OPP_KV in the Pages project's
// dashboard settings, reached via context.env.OPP_KV. If the binding
// is missing the endpoint still returns 204 (the site keeps working)
// but logs a loud console.error per event — dropped analytics must be
// VISIBLE in the function logs, never a silent no-op.
//
// Storage schema (see TRACKING.md): one JSON object per day in KV,
//   key:   opp:day:YYYY-MM-DD        (expirationTtl 35 days, UTC)
//   value: { "{page}|{event}": count, ... }  (read-modify-write)

const ALLOWED_TYPES = new Set(['pv', 'tel', 'form_start', 'form_submit']);

// Obvious bots/crawlers/scrapers — never count them.
const BOT_RE =
  /bot|crawl|spider|slurp|mediapartners|baiduspider|yandex|duckduckbot|bingpreview|headless|phantomjs|puppeteer|selenium|playwright|facebookexternalhit|twitterbot|linkedinbot|embedly|quora|slackbot|telegrambot|whatsapp|discordbot|ahrefs|semrush|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|uptimerobot|pingdom/i;

// Keep 35 days of daily keys (dashboard shows 30) so storage stays bounded.
const TTL_SECONDS = 35 * 24 * 60 * 60;
const DEDUP_TTL_SECONDS = 300;

// Allowlist-style cleanup of the reported page path.
function cleanPage(p) {
  var s = String(p || '/').slice(0, 120).toLowerCase();
  s = s.replace(/[^a-z0-9/_-]/g, '').replace(/\/+$/, '');
  return s || '/';
}

function validDid(d) {
  return /^[0-9a-f-]{8,36}$/i.test(String(d || ''));
}

export async function onRequestPost({ request, env }) {
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

    const kv = env && env.OPP_KV ? env.OPP_KV : null;
    if (!kv) {
      // Storage not configured: this event is being DROPPED. The client
      // still gets its normal 204, but the data loss is logged loudly so
      // a missing OPP_KV binding shows up in the function logs immediately.
      console.error(
        '[analytics/track] WARNING: KV storage not configured — dropping ' +
          type + ' event for ' + page +
          ' (OPP_KV Cloudflare KV binding missing)'
      );
    } else {
      // Server-side dedupe for conversion events: client sends a UUID per
      // interaction; if we've seen it in the last 5 min, count nothing.
      // (pageviews skip this — client-side dedupe covers them.)
      if ((type === 'tel' || type === 'form_submit') && validDid(body.did)) {
        const dedupKey = 'opp:dedup:' + body.did;
        if ((await kv.get(dedupKey)) !== null) {
          return new Response(null, { status: 204 });
        }
        await kv.put(dedupKey, '1', { expirationTtl: DEDUP_TTL_SECONDS });
      }

      // Read-modify-write the day's JSON counter object. Races are
      // acceptable at this site's event volume (a handful per day).
      let counts = {};
      const raw = await kv.get(day);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') counts = parsed;
        } catch {
          console.error('[analytics/track] WARNING: existing ' + day + ' value is not valid JSON; starting fresh.');
        }
      }
      const field = page + '|' + type;
      counts[field] = (counts[field] || 0) + 1;
      await kv.put(day, JSON.stringify(counts), { expirationTtl: TTL_SECONDS });
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    // Fails open: analytics must never break the site or show errors to visitors.
    console.error('[analytics/track]', err);
    return new Response(null, { status: 204 });
  }
}
