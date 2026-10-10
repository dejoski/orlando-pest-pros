// Quote-lead storage.
// ---------------------------------------------------------------
// Leads are persisted to the Cloudflare KV namespace bound as
// OPP_KV (see wrangler.toml) — the same store the analytics
// collector uses (src/pages/api/track.js) — so the private
// dashboard can read them back:
//
//   key:   opp:leads           (one JSON array, newest first)
//   item:  QuoteLead objects inside the array
//   cap:   array is trimmed to the most recent 1,000 leads and
//          has NO expiry (unlike the 35-day analytics keys) — a
//          lead is a business record, not a stat.
//
// The binding is per-request runtime state, so the API route
// passes it in: storeLead(lead, locals.runtime.env.OPP_KV).
//
// If the binding is missing, the lead cannot be persisted: it is
// still written to the server log (fallback) and a loud
// console.error flags the missing configuration — but until the
// OPP_KV binding exists, NO durable copy is kept.

export interface QuoteLead {
  name: string;
  phone: string;
  service: string;
  city: string;
  message?: string;
  source: string; // page path the form was submitted from
  submittedAt: string; // ISO timestamp
}

// Minimal structural view of the Cloudflare KV namespace binding
// (the subset this module uses).
export interface OppKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const LEADS_KEY = "opp:leads";
const LEADS_CAP = 1000;

export async function storeLead(lead: QuoteLead, kv?: OppKv | null): Promise<{ ok: true }> {
  // Fallback record: the lead always lands in the server function
  // log, even if durable storage below fails or isn't configured.
  console.log("[quote-lead]", JSON.stringify(lead));

  if (!kv) {
    console.error(
      "[quote-lead] WARNING: lead storage is NOT configured " +
        "(OPP_KV Cloudflare KV binding missing) — " +
        "this lead exists ONLY in the function log and will be lost when logs rotate.",
    );
    return { ok: true };
  }

  try {
    // Read-modify-write: the array is newest-first, so prepend and
    // cap. Races are acceptable at this site's lead volume.
    const raw = await kv.get(LEADS_KEY);
    let leads: QuoteLead[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) leads = parsed;
      } catch {
        console.error("[quote-lead] WARNING: existing " + LEADS_KEY + " value is not valid JSON; starting a fresh array.");
      }
    }
    leads.unshift(lead);
    if (leads.length > LEADS_CAP) leads.length = LEADS_CAP;
    await kv.put(LEADS_KEY, JSON.stringify(leads));
  } catch (e) {
    // Don't fail the visitor's submission over a storage outage —
    // the lead is already in the function log (above); make the
    // storage failure loud instead of silent.
    console.error("[quote-lead] WARNING: failed to persist lead to KV store:", e);
  }
  return { ok: true };
}

const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;

export function validateLead(input: Record<string, unknown>): { lead?: QuoteLead; error?: string } {
  const name = String(input.name ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const service = String(input.service ?? "").trim();
  const city = String(input.city ?? "").trim();
  const message = String(input.message ?? "").trim().slice(0, 1000);
  const source = String(input.source ?? "/").slice(0, 200);

  if (input.website) return { error: "spam" }; // honeypot
  if (name.length < 2) return { error: "Please enter your name." };
  if (!PHONE_RE.test(phone)) return { error: "Please enter a valid phone number." };
  if (!service) return { error: "Please choose a service." };
  if (!city) return { error: "Please choose your city." };

  return {
    lead: { name, phone, service, city, message, source, submittedAt: new Date().toISOString() },
  };
}
