// Cloudflare storage Worker client ("opp-store", workers/opp-store/).
// ---------------------------------------------------------------
// Why: the Vercel KV store this site was built against was never
// connected — its env vars (KV_REST_API_URL / KV_REST_API_TOKEN or the
// UPSTASH_* pair) can't be set from our automation because the Vercel
// dashboard sign-in demands a GitHub password re-entry. The Worker is
// the approved route-around: it lives on Cloudflare, and BOTH its URL
// and the shared secret are committed here in the repo, so the
// git-connected Vercel deploy configures everything with zero
// dashboard steps.
//
// Usage contract for callers (api/track.js, lib/leads.ts, dashboard):
//   - If cfStoreConfigured() is true, try the Worker FIRST.
//   - On ANY Worker failure, fall back to the previous Vercel KV path.
//   - If neither works, keep the existing behavior (loud console.error;
//     the visitor's request never fails over analytics/lead storage).
//
// GO-LIVE NOTE: CF_STORE_URL below carries the placeholder subdomain
// "REPLACE-WITH-ACCOUNT-SUBDOMAIN" until the Worker is first deployed.
// `wrangler deploy` prints the real *.workers.dev URL; paste it here
// (one line) and push. Until then cfStoreConfigured() returns false and
// the site behaves exactly as it did before this file existed.
// Secret rotation: change CF_STORE_SECRET here AND OPP_SHARED_SECRET
// in workers/opp-store/wrangler.toml, redeploy the Worker, push.

export const CF_STORE_URL =
  "https://opp-store.REPLACE-WITH-ACCOUNT-SUBDOMAIN.workers.dev";
export const CF_STORE_SECRET = "61cbeac1906948a4924744e363422dfe835202f1f1b00f50";

const TIMEOUT_MS = 2500; // a slow/dead store must never hang a request

export function cfStoreConfigured(): boolean {
  return (
    CF_STORE_URL.startsWith("https://") &&
    !CF_STORE_URL.includes("REPLACE-WITH-ACCOUNT-SUBDOMAIN") &&
    CF_STORE_SECRET.length >= 16
  );
}

async function cfFetch(path: string, init: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(CF_STORE_URL.replace(/\/+$/, "") + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-opp-key": CF_STORE_SECRET,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res;
  } catch {
    return null; // network error / timeout — caller falls back
  }
}

// POST one analytics event { t, p, did? } to the Worker.
// Returns true only when the Worker accepted it (2xx).
export async function cfStoreTrack(event: {
  t: string;
  p: string;
  did?: string;
}): Promise<boolean> {
  if (!cfStoreConfigured()) return false;
  const res = await cfFetch("/track", {
    method: "POST",
    body: JSON.stringify(event),
  });
  return !!res && res.ok;
}

// POST one validated lead to the Worker. Returns true on 2xx.
export async function cfStoreLead(lead: unknown): Promise<boolean> {
  if (!cfStoreConfigured()) return false;
  const res = await cfFetch("/lead", {
    method: "POST",
    body: JSON.stringify(lead),
  });
  return !!res && res.ok;
}

export interface CfStoreRead {
  generatedAt: string;
  days: Record<string, Record<string, number>>;
  leads: Array<Record<string, unknown>>;
  leadsTotal: number;
}

// GET the stored counters + leads back (dashboard / manual reads).
export async function cfStoreRead(days = 30): Promise<CfStoreRead | null> {
  if (!cfStoreConfigured()) return null;
  const res = await cfFetch("/read?days=" + days, { method: "GET" });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as CfStoreRead;
    if (!data || typeof data !== "object" || typeof data.days !== "object") return null;
    return data;
  } catch {
    return null;
  }
}
