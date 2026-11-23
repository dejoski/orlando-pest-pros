// functions/api/quote.js — Cloudflare Pages Function port of
// src/pages/api/quote.ts + src/lib/leads.ts (quote-lead intake).
//
// This exists so the endpoint also runs when the site is deployed via
// the Cloudflare Pages dashboard Direct Upload flow, where the Astro
// build's dist/_worker.js directory is NOT activated (only Pages
// Functions are). The Astro route + leads.ts remain the
// wrangler-deploy path; keep the two implementations in sync.
//
// Leads are persisted to the KV namespace bound as OPP_KV in the
// Pages project's dashboard settings (context.env.OPP_KV):
//
//   key:   opp:leads           (one JSON array, newest first)
//   item:  lead objects inside the array
//   cap:   array is trimmed to the most recent 1,000 leads and
//          has NO expiry (unlike the 35-day analytics keys) — a
//          lead is a business record, not a stat.
//
// If the binding is missing, the lead cannot be persisted: it is
// still written to the function log (fallback) and a loud
// console.error flags the missing configuration — but until the
// OPP_KV binding exists, NO durable copy is kept.

// ---------------------------------------------------------------
// Ported from src/lib/leads.ts (types stripped; logic identical).
// ---------------------------------------------------------------

const LEADS_KEY = 'opp:leads';
const LEADS_CAP = 1000;

async function storeLead(lead, kv) {
  // Fallback record: the lead always lands in the server function
  // log, even if durable storage below fails or isn't configured.
  console.log('[quote-lead]', JSON.stringify(lead));

  if (!kv) {
    console.error(
      '[quote-lead] WARNING: lead storage is NOT configured ' +
        '(OPP_KV Cloudflare KV binding missing) — ' +
        'this lead exists ONLY in the function log and will be lost when logs rotate.'
    );
    return { ok: true };
  }

  try {
    // Read-modify-write: the array is newest-first, so prepend and
    // cap. Races are acceptable at this site's lead volume.
    const raw = await kv.get(LEADS_KEY);
    let leads = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) leads = parsed;
      } catch {
        console.error('[quote-lead] WARNING: existing ' + LEADS_KEY + ' value is not valid JSON; starting a fresh array.');
      }
    }
    leads.unshift(lead);
    if (leads.length > LEADS_CAP) leads.length = LEADS_CAP;
    await kv.put(LEADS_KEY, JSON.stringify(leads));
  } catch (e) {
    // Don't fail the visitor's submission over a storage outage —
    // the lead is already in the function log (above); make the
    // storage failure loud instead of silent.
    console.error('[quote-lead] WARNING: failed to persist lead to KV store:', e);
  }
  return { ok: true };
}

const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;

function validateLead(input) {
  const name = String(input.name ?? '').trim();
  const phone = String(input.phone ?? '').trim();
  const service = String(input.service ?? '').trim();
  const city = String(input.city ?? '').trim();
  const message = String(input.message ?? '').trim().slice(0, 1000);
  const source = String(input.source ?? '/').slice(0, 200);

  if (input.website) return { error: 'spam' }; // honeypot
  if (name.length < 2) return { error: 'Please enter your name.' };
  if (!PHONE_RE.test(phone)) return { error: 'Please enter a valid phone number.' };
  if (!service) return { error: 'Please choose a service.' };
  if (!city) return { error: 'Please choose your city.' };

  return {
    lead: { name, phone, service, city, message, source, submittedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------
// Ported from src/pages/api/quote.ts (handler; logic identical).
// ---------------------------------------------------------------

// CORS: the apex domain (orlandopestcontrol.top, a static GitHub Pages
// build) posts here cross-origin from the browser, so preflights must be
// answered and every response must carry Access-Control-Allow-Origin —
// otherwise the browser blocks the form from reading the result even
// though the lead was stored.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  let input = {};
  try {
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      input = await request.json();
    } else {
      // The apex quote form submits URL-encoded data (its JS fetch uses
      // URLSearchParams; the no-JS fallback is a plain form POST).
      // Accept it alongside JSON; validation/storage are unchanged.
      const fd = await request.formData();
      input = Object.fromEntries(fd.entries());
      if (!input.source && input.source_page) input.source = input.source_page;
    }
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  const { lead, error } = validateLead(input);
  if (!lead) {
    // Honeypot trips return a fake success so bots can't probe validation.
    if (error === 'spam') return json({ ok: true });
    return json({ ok: false, error }, 400);
  }

  try {
    await storeLead(lead, env && env.OPP_KV ? env.OPP_KV : null);
  } catch (e) {
    console.error('[quote-lead] store failed', e);
    return json({ ok: false, error: "Couldn't save your request. Please call us instead." }, 500);
  }

  return json({ ok: true });
}
