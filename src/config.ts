// ============================================================
// ORLANDO PEST PROS — SITE CONFIG
// Single source of truth for phone, verification, and snippets.
// ------------------------------------------------------------
// Contact CTAs use the configured tracking number or the quote form.
// ============================================================

export const SITE_NAME = "Orlando Pest Pros";
export const SITE_TAGLINE = "Local pest-control quote requests";

// Set a real routed call-tracking number at build time. Until configured,
// contact links send visitors to the quote form instead of a fake number.
const configuredPhone = (import.meta.env.PUBLIC_TRACKING_PHONE_NUMBER || "").trim();
const phoneDigits = configuredPhone.replace(/\D/g, "");
const nationalDigits = phoneDigits.length === 11 && phoneDigits.startsWith("1")
  ? phoneDigits.slice(1) : phoneDigits;
export const HAS_PHONE = /^[2-9]\d{2}[2-9]\d{6}$/.test(nationalDigits)
  && nationalDigits.slice(3, 6) !== "555";
export const PHONE_TEL = HAS_PHONE ? `+1${nationalDigits}` : "";
export const PHONE_DISPLAY = HAS_PHONE
  ? `(${nationalDigits.slice(0, 3)}) ${nationalDigits.slice(3, 6)}-${nationalDigits.slice(6)}`
  : "";
export const CONTACT_LABEL = HAS_PHONE ? `Call ${PHONE_DISPLAY}` : "Request a quote";

// DEJAN: update after Vercel deploy (or once the real domain is bought).
export const SITE_URL = "https://orlandopestcontrol.top";

// --- Search Console / Bing verification ----------------------
// Paste tokens here when available; the <meta> tags render only
// when non-empty. File-based verification: drop the provider's
// file at the exact path requested by the provider under public/.
export const GOOGLE_SITE_VERIFICATION = "";
export const BING_SITE_VERIFICATION = "";

// --- Analytics ------------------------------------------------
// Wired from analytics/INTEGRATION.md when that module lands.
// Paste the snippet HTML here; it is injected before </head>.
export const ANALYTICS_SNIPPET = "";

export const SERVICE_AREA = "Osceola & Orange Counties";
export const SERVICE_AREA_LONG = "Osceola and Orange Counties, Florida";
export const COUNTIES = ["Osceola County", "Orange County"];


export const telLink = HAS_PHONE ? `tel:${PHONE_TEL}` : "/#quote";

