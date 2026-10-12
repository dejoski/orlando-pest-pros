import cities from "../data/cities.json";
import services from "../data/services.json";

export interface QuoteLead {
  name: string;
  phone: string;
  service: string;
  city: string;
  message?: string;
  source: string;
  submittedAt: string;
  attribution?: Record<string, string>;
}

export const LEADS_KEY = "opp:leads";
const LEADS_CAP = 1000;
const cityNames = new Set([...cities.cities.map(c => c.name), "Other (Orlando area)"]);
const serviceNames = new Set(services.services.map(s => s.name));

// Use a complete credential pair; never mix two different Redis providers.
function kvConfig(): { base: string; token: string } | null {
  const env = import.meta.env ?? process.env;
  for (const [urlKey, tokenKey] of [["KV_REST_API_URL", "KV_REST_API_TOKEN"], ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]]) {
    const url = env[urlKey];
    const token = env[tokenKey];
    if (url && token) return { base: String(url).replace(/\/+$/, ""), token: String(token) };
  }
  return null;
}

export async function storeLead(lead: QuoteLead): Promise<{ ok: true }> {
  const cfg = kvConfig();
  if (!cfg) throw new Error("Lead storage is not configured");
  // No lead data or credentials are logged. A pipeline can return HTTP 200
  // while an individual Redis command fails, so check every command result.
  const res = await fetch(cfg.base + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["LPUSH", LEADS_KEY, JSON.stringify(lead)],
      ["LTRIM", LEADS_KEY, 0, LEADS_CAP - 1],
    ]),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("Lead storage unavailable");
  const results = await res.json();
  if (!Array.isArray(results) || results.length !== 2 || results.some(r => !r || r.error) ||
      !Number.isInteger(results[0].result) || results[0].result < 1 || results[1].result !== "OK") {
    throw new Error("Lead storage did not confirm persistence");
  }
  return { ok: true };
}

const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;
const field = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function validateLead(input: unknown): { lead?: QuoteLead; error?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Invalid request." };
  const data = input as Record<string, unknown>;
  if (data.website) return { error: "spam" };
  const name = field(data.name);
  const phone = field(data.phone);
  const service = field(data.service);
  const city = field(data.city);
  const message = field(data.message);
  const source = data.source === undefined ? "/" : field(data.source);
  if (name.length < 2 || name.length > 100) return { error: "Please enter a name between 2 and 100 characters." };
  const digits = phone.replace(/\D/g, "");
  if (!PHONE_RE.test(phone) || digits.length < 7 || digits.length > 15) return { error: "Please enter a valid phone number." };
  if (!serviceNames.has(service)) return { error: "Please choose a service." };
  if (!cityNames.has(city)) return { error: "Please choose your city." };
  if (message.length > 1000 || (data.message !== undefined && typeof data.message !== "string")) return { error: "Please keep your message under 1,000 characters." };
  if (source.length > 200 || !/^\/(?!\/)[^\s?#]*$/.test(source)) return { error: "Invalid page source." };
  const attribution: Record<string, string> = {};
  if (data.attribution && typeof data.attribution === "object" && !Array.isArray(data.attribution)) {
    const supplied = data.attribution as Record<string, unknown>;
    const channels = ["organic", "paid", "referral", "direct", "unknown"];
    if (typeof supplied.channel === "string" && channels.includes(supplied.channel)) attribution.channel = supplied.channel;
    const engines = ["google", "bing", "duckduckgo", "yahoo", "ecosia", "brave", "", "other"];
    if (typeof supplied.referrer === "string" && engines.includes(supplied.referrer)) attribution.referrer = supplied.referrer;
    if (typeof supplied.landingPage === "string") {
      const path = supplied.landingPage.split(/[?#]/)[0];
      if (path.length <= 200 && /^\/(?!\/)[^\s]*$/.test(path)) attribution.landingPage = path;
    }
  }
  return { lead: { name, phone, service, city, message, source, submittedAt: new Date().toISOString(), ...(Object.keys(attribution).length ? { attribution } : {}) } };
}
