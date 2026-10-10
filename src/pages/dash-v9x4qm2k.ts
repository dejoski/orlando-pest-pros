// src/pages/dash-v9x4qm2k.ts — PRIVATE analytics dashboard.
//
// Implemented as an API endpoint that returns a hand-built HTML string
// (not an .astro page) because the .astro SSR page render degenerates to
// "[object Object]" on Cloudflare Pages in production, while endpoints
// (/api/quote, /api/track) render fine. Same URL, same behavior.
//
// The random suffix makes the path non-guessable; access additionally
// requires the token query param `?k=` matching the DASHBOARD_TOKEN env
// var (see SETUP.md).
// Full URL for Dejan: https://<site>/dash-v9x4qm2k?k=<DASHBOARD_TOKEN>
//
// Zero npm dependencies; plain inline styles so it renders without Tailwind.
//
// SECURITY: this page is built by string concatenation, so every value
// that can contain user/request data is HTML-escaped via esc() before
// interpolation — a stored lead must not be able to inject markup here.

import type { APIRoute } from "astro";
import { LEADS_KEY, type OppKv, type QuoteLead } from "../lib/leads";

export const prerender = false;

const TYPES = ["pv", "tel", "form_start", "form_submit"] as const;
type EventType = (typeof TYPES)[number];
const DAYS = 30;
const LEADS_SHOWN = 50;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dayStamp(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

interface PageCounts {
  pv: number;
  tel: number;
  form_start: number;
  form_submit: number;
}

interface PageRow extends PageCounts {
  page: string;
  conv: number;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const TOKEN =
    (typeof process !== "undefined" && process.env && process.env.DASHBOARD_TOKEN) ||
    import.meta.env.DASHBOARD_TOKEN;
  if (!TOKEN || url.searchParams.get("k") !== TOKEN) {
    // 404 (not 403) so scanners can't tell the page exists.
    return new Response("Not found", { status: 404 });
  }

  // Storage: the Cloudflare KV namespace bound as OPP_KV (wrangler.toml),
  // reached per-request via locals.runtime.env (same access style as
  // src/pages/api/quote.ts).
  const kv: OppKv | null = locals?.runtime?.env?.OPP_KV ?? null;

  // One JSON object per day: opp:day:YYYY-MM-DD, fields "{page}|{type}" -> count.
  // Dashboard = the last 30 day keys (computed explicitly; no KV list())
  // + the opp:leads array.
  let rows: PageRow[] = [];
  const totals: PageCounts = { pv: 0, tel: 0, form_start: 0, form_submit: 0 };
  let leads: QuoteLead[] = [];
  let leadsTotal = 0;
  let kvError = "";

  try {
    if (!kv) {
      kvError = "KV not connected: the OPP_KV Cloudflare KV binding is missing. See SETUP.md.";
    } else {
      const dayKeys: string[] = [];
      for (let d = 0; d < DAYS; d++) dayKeys.push("opp:day:" + dayStamp(d));
      const [dayValues, leadsRaw] = await Promise.all([
        Promise.all(dayKeys.map((k) => kv.get(k))),
        kv.get(LEADS_KEY),
      ]);

      const perPage: Record<string, PageCounts> = {};
      for (const raw of dayValues) {
        if (!raw) continue;
        let h: unknown;
        try {
          h = JSON.parse(raw);
        } catch {
          continue; // skip malformed day values
        }
        if (!h || typeof h !== "object") continue;
        for (const [field, n] of Object.entries(h as Record<string, unknown>)) {
          const i = field.lastIndexOf("|");
          if (i < 0) continue;
          const page = field.slice(0, i);
          const type = field.slice(i + 1);
          if (!(TYPES as readonly string[]).includes(type)) continue;
          if (!perPage[page]) perPage[page] = { pv: 0, tel: 0, form_start: 0, form_submit: 0 };
          perPage[page][type as EventType] += parseInt(String(n), 10) || 0;
        }
      }

      rows = Object.entries(perPage)
        .map(([page, c]) => ({
          page,
          ...c,
          conv: c.pv > 0 ? (100 * c.form_submit) / c.pv : 0,
        }))
        .sort((a, b) => b.pv - a.pv);

      for (const r of rows) for (const t of TYPES) totals[t] += r[t];

      // Leads: one JSON array, newest first; show the newest LEADS_SHOWN.
      let allLeads: QuoteLead[] = [];
      if (leadsRaw) {
        try {
          const parsed = JSON.parse(leadsRaw);
          if (Array.isArray(parsed)) allLeads = parsed;
        } catch { /* malformed stored value: treat as no leads */ }
      }
      leadsTotal = allLeads.length;
      for (const l of allLeads.slice(0, LEADS_SHOWN)) {
        if (l && l.name && l.phone) leads.push(l);
      }
    }
  } catch (e) {
    kvError = "Could not read analytics store: " + (e && (e as Error).message ? (e as Error).message : e);
  }

  const totalConv = totals.pv > 0 ? (100 * totals.form_submit) / totals.pv : 0;

  const pageRowsHtml =
    rows.length === 0
      ? `<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No data yet — events appear here after the first tracked visit.</td></tr>`
      : rows
          .map(
            (r) => `<tr>
            <td class="mono">${esc(r.page)}</td>
            <td>${r.pv.toLocaleString()}</td>
            <td>${r.tel.toLocaleString()}</td>
            <td>${r.form_start.toLocaleString()}</td>
            <td>${r.form_submit.toLocaleString()}</td>
            <td class="conv">${r.conv.toFixed(1)}%</td>
          </tr>`,
          )
          .join("\n");

  const leadRowsHtml =
    leads.length === 0
      ? `<tr><td colspan="7" style="text-align:center; color:#94a3b8;">No leads stored yet — submissions appear here once the KV store is connected and the form is used.</td></tr>`
      : leads
          .map(
            (l) => `<tr>
            <td class="when">${esc(String(l.submittedAt || "").replace("T", " ").slice(0, 16))}</td>
            <td>${esc(l.name)}</td>
            <td class="mono">${esc(l.phone)}</td>
            <td>${esc(l.service)}</td>
            <td>${esc(l.city)}</td>
            <td>${esc(l.message || "")}</td>
            <td class="mono">${esc(l.source || "")}</td>
          </tr>`,
          )
          .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Analytics — Orlando Pest Pros (private)</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 16px; margin: 32px 0 4px; }
    .sub { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #1e293b; border-radius: 10px; padding: 14px; }
    .card .n { font-size: 26px; font-weight: 700; }
    .card .l { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 10px; overflow: hidden; font-size: 14px; }
    th, td { text-align: right; padding: 10px 12px; border-bottom: 1px solid #334155; }
    th:first-child, td:first-child { text-align: left; }
    th { color: #94a3b8; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    tr:last-child td { border-bottom: none; }
    .mono { font-family: ui-monospace, monospace; font-size: 13px; word-break: break-all; }
    table.leads th, table.leads td { text-align: left; vertical-align: top; }
    table.leads td.when { white-space: nowrap; color: #94a3b8; }
    .err { background: #7f1d1d; border-radius: 10px; padding: 14px; margin-bottom: 20px; }
    .conv { color: #4ade80; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Orlando Pest Pros — Analytics</h1>
    <div class="sub">Last ${DAYS} days · UTC · private dashboard</div>
${kvError ? `\n    <div class="err">${esc(kvError)}</div>\n` : ""}
    <div class="cards">
      <div class="card"><div class="n">${totals.pv.toLocaleString()}</div><div class="l">Pageviews</div></div>
      <div class="card"><div class="n">${totals.tel.toLocaleString()}</div><div class="l">Call-link taps</div></div>
      <div class="card"><div class="n">${totals.form_start.toLocaleString()}</div><div class="l">Quote-form starts</div></div>
      <div class="card"><div class="n">${totals.form_submit.toLocaleString()}</div><div class="l">Quote-form submits</div></div>
      <div class="card"><div class="n">${totalConv.toFixed(1)}%</div><div class="l">Overall conversion (submit / pv)</div></div>
      <div class="card"><div class="n">${leadsTotal.toLocaleString()}</div><div class="l">Quote leads stored</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Page</th><th>Pageviews</th><th>Call taps</th><th>Form starts</th><th>Form submits</th><th>Conv. rate</th>
        </tr>
      </thead>
      <tbody>
        ${pageRowsHtml}
      </tbody>
    </table>

    <h2>Quote leads</h2>
    <div class="sub">Most recent ${LEADS_SHOWN} stored leads · newest first · persisted by the quote form in the ${LEADS_KEY} array</div>
    <table class="leads">
      <thead>
        <tr>
          <th>Submitted (UTC)</th><th>Name</th><th>Phone</th><th>Service</th><th>City</th><th>Message</th><th>Page</th>
        </tr>
      </thead>
      <tbody>
        ${leadRowsHtml}
      </tbody>
    </table>
  </div>
</body>
</html>
`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" },
  });
};
