// ============================================================
// ORLANDO PEST PROS — SITE CONFIG
// Single source of truth for phone, verification, and snippets.
// ------------------------------------------------------------
// DEJAN: swap PHONE_DISPLAY / PHONE_TEL with your call-tracking
// number when ready. Every call CTA on the site reads from the
// two constants below — nothing else to change.
// ============================================================

export const SITE_NAME = "Orlando Pest Pros";
export const SITE_TAGLINE = "Orlando's local pest experts";

// DEJAN: swap with tracking number (display format, e.g. "(407) 123-4567")
export const PHONE_DISPLAY = "(407) 555-0148";
// DEJAN: swap with tracking number (E.164 for tel: links, e.g. "+14071234567")
export const PHONE_TEL = "+14075550148";

// DEJAN: update after Vercel deploy (or once the real domain is bought).
export const SITE_URL = "https://orlandopestcontrol.top";

// --- Search Console / Bing verification ----------------------
// Paste tokens here when available; the <meta> tags render only
// when non-empty. File-based verification: drop the provider's
// file into public/.well-known/ (it is copied to the site root).
export const GOOGLE_SITE_VERIFICATION = "";
export const BING_SITE_VERIFICATION = "";

// --- Analytics ------------------------------------------------
// Wired from analytics/INTEGRATION.md when that module lands.
// Paste the snippet HTML here; it is injected before </head>.
export const ANALYTICS_SNIPPET = "";

export const SERVICE_AREA = "Osceola & Orange Counties";
export const SERVICE_AREA_LONG = "Osceola and Orange Counties, Florida";
export const COUNTIES = ["Osceola County", "Orange County"];
export const HOURS = "Mon–Sat: 7am–7pm";

export const telLink = `tel:${PHONE_TEL}`;
