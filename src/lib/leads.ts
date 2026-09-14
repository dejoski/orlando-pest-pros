// Quote-lead storage abstraction.
// ---------------------------------------------------------------
// INTEGRATION POINT: the analytics module (analytics/INTEGRATION.md,
// currently being built by a parallel workstream) defines the final
// storage endpoint. Until it lands, validated leads are logged
// server-side and acknowledged — no lead is silently dropped, and
// swapping in the real store means editing ONE function below.

export interface QuoteLead {
  name: string;
  phone: string;
  service: string;
  city: string;
  message?: string;
  source: string; // page path the form was submitted from
  submittedAt: string; // ISO timestamp
}

export async function storeLead(lead: QuoteLead): Promise<{ ok: true }> {
  // TODO(analytics): replace with the endpoint from analytics/INTEGRATION.md
  // e.g. await fetch(ANALYTICS_LEAD_ENDPOINT, { method: "POST", body: JSON.stringify(lead) });
  console.log("[quote-lead]", JSON.stringify(lead));
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
