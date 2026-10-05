// Quote-lead storage.
// ---------------------------------------------------------------
// Leads are persisted to the same Vercel KV / Upstash store the
// analytics collector uses (src/pages/api/track.js), in a Redis
// list so the private dashboard can read them back:
//
//   key:  opp:leads            (LPUSH, newest first)
//   item: JSON-serialized QuoteLead
//   cap:  list is trimmed to the most recent 1,000 leads and has
//         NO expiry (unlike the 35-day analytics hashes) — a lead
//         is a business record, not a stat.
//
// Env vars (same pairs as the analytics module; auto-attached when
// the KV database is connected to the Vercel project):
//   KV_REST_API_URL / KV_REST_API_TOKEN                (Vercel KV)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Upstash)
//
// If neither pair is set, the lead cannot be persisted: it is
// still written to the server log (fallback) and a loud
// console.error flags the missing configuration — but until the
// env vars exist in the Vercel project, NO durable copy is kept.

export interface QuoteLead {
  name: string;
  phone: string;
  service: string;
  city: string;
  message?: string;
  source: string; // page path the form was submitted from
  submittedAt: string; // ISO timestamp
}

export const LEADS_KEY = "opp:leads";
const LEADS_CAP = 1000;

function kvConfig(): { base: string; token: string } | null {
  const url = import.meta.env.KV_REST_API_URL || import.meta.env.UPSTASH_REDIS_REST_URL || "";
  const token = import.meta.env.KV_REST_API_TOKEN || import.meta.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  return { base: String(url).replace(/\/+$/, ""), token: String(token) };
}

export async function storeLead(lead: QuoteLead): Promise<{ ok: true }> {
  // Fallback record: the lead always lands in the server function
  // log, even if durable storage below fails or isn't configured.
  console.log("[quote-lead]", JSON.stringify(lead));

  const cfg = kvConfig();
  if (!cfg) {
    console.error(
      "[quote-lead] WARNING: lead storage is NOT configured " +
        "(KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN missing) — " +
        "this lead exists ONLY in the function log and will be lost when logs rotate.",
    );
    return { ok: true };
  }

  try {
    const res = await fetch(cfg.base + "/pipeline", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + cfg.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["LPUSH", LEADS_KEY, JSON.stringify(lead)],
        ["LTRIM", LEADS_KEY, 0, LEADS_CAP - 1],
      ]),
    });
    if (!res.ok) throw new Error("kv pipeline failed: " + res.status);
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
