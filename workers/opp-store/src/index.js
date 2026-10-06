// workers/opp-store — Orlando Pest Pros storage Worker.
//
// Why this exists: the site (Vercel) persists analytics + quote leads to
// Vercel KV, but the KV env vars were never set on the Vercel project and
// the Vercel dashboard cannot be reached from our automation (sign-in
// demands a GitHub password re-entry). This Worker is the route-around:
// the site's server-side code POSTs events/leads here instead, and we can
// read everything back through GET /read. No Vercel env vars involved —
// the Worker URL + shared secret live in the repo (see src/lib/cf-store.ts
// on the site side, [vars] in wrangler.toml on this side).
//
// Storage: Cloudflare KV, FIXED KEYS ONLY — this Worker never calls
// KV list(). The free tier caps list operations at 1,000/day (this
// account already burned that cap once, 2026-10-03); fixed keys avoid
// the list API entirely. Schema:
//
//   opp:day:YYYY-MM-DD   JSON object { "{page}|{event}": count, ... }
//                        (mirrors the Redis-hash schema the site used;
//                        expirationTtl 35 days, refreshed on every write)
//   opp:leads            JSON array of lead objects, newest first,
//                        capped at 1,000, NO expiry (business record)
//   opp:dedup:<uuid>     "1", expirationTtl 300s — conversion-event
//                        dedupe, same semantics as the old Redis SET NX
//
// Counts are read-modify-write per event. At this site's volume
// (~40 impressions in its first 3 weeks) a lost increment from a
// simultaneous write is a non-issue; leads use the same pattern.
//
// Endpoints (all require header  x-opp-key: <OPP_SHARED_SECRET>,
// except /health):
//   GET  /health           -> { ok: true }
//   POST /track  {t,p,did} -> { ok: true, counted: bool }
//   POST /lead   {lead...} -> { ok: true }
//   GET  /read?days=30     -> { generatedAt, days: {...}, leads, leadsTotal }
//
// Bot filtering intentionally stays on the site side (src/pages/api/track.js
// is the public endpoint and filters by user-agent before forwarding);
// this Worker is only ever called server-to-server with the secret.

const ALLOWED_TYPES = new Set(['pv', 'tel', 'form_start', 'form_submit']);
const DAY_TTL_SECONDS = 35 * 24 * 60 * 60;
const DEDUP_TTL_SECONDS = 300;
const LEADS_KEY = 'opp:leads';
const LEADS_CAP = 1000;
const MAX_READ_DAYS = 35;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Constant-time-ish string compare (lengths here are not secret-sensitive
// beyond the value itself; this just avoids a naive early-exit compare).
function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  return secretMatches(request.headers.get('x-opp-key') || '', env.OPP_SHARED_SECRET || '');
}

// Same allowlist cleanup the site applies (defense in depth).
function cleanPage(p) {
  let s = String(p || '/').slice(0, 120).toLowerCase();
  s = s.replace(/[^a-z0-9/_-]/g, '').replace(/\/+$/, '');
  return s || '/';
}

function validDid(d) {
  return /^[0-9a-f-]{8,36}$/i.test(String(d || ''));
}

function dayKey(date) {
  return 'opp:day:' + date.toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

async function handleTrack(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  const type = String(body.t || '');
  if (!ALLOWED_TYPES.has(type)) return json({ ok: false, error: 'bad type' }, 400);
  const page = cleanPage(body.p);

  // Conversion-event dedupe (tel / form_submit), 5-minute window —
  // same semantics as the old Redis SET NX EX in /api/track.
  if ((type === 'tel' || type === 'form_submit') && validDid(body.did)) {
    const dedupKey = 'opp:dedup:' + body.did;
    const seen = await env.OPP_KV.get(dedupKey);
    if (seen !== null) return json({ ok: true, counted: false });
    await env.OPP_KV.put(dedupKey, '1', { expirationTtl: DEDUP_TTL_SECONDS });
  }

  const key = dayKey(new Date());
  let counts = {};
  const raw = await env.OPP_KV.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') counts = parsed;
    } catch { /* corrupt value: start fresh rather than drop the event */ }
  }
  const field = page + '|' + type;
  counts[field] = (parseInt(counts[field], 10) || 0) + 1;
  await env.OPP_KV.put(key, JSON.stringify(counts), { expirationTtl: DAY_TTL_SECONDS });
  return json({ ok: true, counted: true });
}

// Light structural check: the site already validated the lead properly
// (validateLead in src/lib/leads.ts); here we only refuse payloads that
// are obviously not a lead, and cap field sizes before storing.
function sanitizeLead(input) {
  if (!input || typeof input !== 'object') return null;
  const str = (v, max) => String(v ?? '').slice(0, max);
  const lead = {
    name: str(input.name, 200).trim(),
    phone: str(input.phone, 40).trim(),
    service: str(input.service, 120),
    city: str(input.city, 120),
    message: str(input.message, 1000),
    source: str(input.source, 200) || '/',
    submittedAt: str(input.submittedAt, 40) || new Date().toISOString(),
  };
  if (lead.name.length < 2 || lead.phone.length < 7) return null;
  return lead;
}

async function handleLead(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  const lead = sanitizeLead(body);
  if (!lead) return json({ ok: false, error: 'invalid lead' }, 400);

  let leads = [];
  const raw = await env.OPP_KV.get(LEADS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) leads = parsed;
    } catch { /* corrupt value: start fresh rather than drop the lead */ }
  }
  leads.unshift(lead); // newest first, same as the old LPUSH list
  if (leads.length > LEADS_CAP) leads.length = LEADS_CAP;
  await env.OPP_KV.put(LEADS_KEY, JSON.stringify(leads)); // no expiry — ever
  return json({ ok: true });
}

async function handleRead(url, env) {
  let days = parseInt(url.searchParams.get('days') || '30', 10);
  if (!Number.isFinite(days) || days < 1) days = 30;
  if (days > MAX_READ_DAYS) days = MAX_READ_DAYS;

  // Fixed keys computed from the calendar — never a list() call.
  const out = {};
  const reads = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKey(d);
    reads.push(
      env.OPP_KV.get(key).then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') out[key.slice(8)] = parsed;
        } catch { /* skip corrupt day */ }
      }),
    );
  }
  let leads = [];
  reads.push(
    env.OPP_KV.get(LEADS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) leads = parsed;
      } catch { /* skip corrupt leads value */ }
    }),
  );
  await Promise.all(reads);

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    days: out,
    leads,
    leadsTotal: leads.length,
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/health') return json({ ok: true });

      if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);

      if (request.method === 'POST' && url.pathname === '/track') return handleTrack(request, env);
      if (request.method === 'POST' && url.pathname === '/lead') return handleLead(request, env);
      if (request.method === 'GET' && url.pathname === '/read') return handleRead(url, env);

      return json({ ok: false, error: 'not found' }, 404);
    } catch (err) {
      // Never leak internals; the site side fails open to its KV path.
      console.error('[opp-store]', err);
      return json({ ok: false, error: 'internal' }, 500);
    }
  },
};
