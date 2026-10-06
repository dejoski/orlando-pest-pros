# opp-store — Cloudflare storage Worker for Orlando Pest Pros

## Why this exists

The site (hosted on Vercel) persists analytics and quote leads to Vercel
KV — but the KV env vars were never set on the Vercel project, and the
Vercel dashboard can't be reached from our automation (its sign-in
demands a GitHub password re-entry). So in production today, every
pageview event is dropped and every lead exists only in function logs.

This Worker is the route-around, approved 2026-10-06: a tiny storage
endpoint on Cloudflare that the site's **server-side** code calls
instead of Vercel KV. It needs **zero new Vercel env vars** — the Worker
URL and shared secret are committed in this (private) repo, and the
site's git-connected Vercel deploy picks them up on merge.

## Storage choice: KV, fixed keys, zero list operations

**Cloudflare KV — because the dataset is a handful of counters and an
append-only lead log that maps 1:1 onto fixed keys, so KV needs no
schema or migrations; D1's SQL would buy nothing at this volume.**

The one hard free-tier constraint: KV free allows 1,000 writes/day and
only **1,000 list operations/day** (this account burned its daily list
cap on 2026-10-03). This Worker therefore **never calls `list()`** —
every key is computed from the calendar or the payload:

| Key | Value | Expiry |
|---|---|---|
| `opp:day:YYYY-MM-DD` (UTC) | JSON `{ "{page}\|{event}": count }` — same schema as the old Redis daily hashes | 35 days, refreshed per write |
| `opp:leads` | JSON array of leads, newest first, capped at 1,000 | **none — leads are business records** |
| `opp:dedup:<uuid>` | `"1"` | 300 s (conversion-event dedupe) |

Cost per tracked event: 1 read + 1 write (pageviews) — hundreds of
events/day of headroom under the 1,000 writes/day free cap; the site
saw ~40 impressions in its first three weeks. Reads via `/read` are a
few dozen fixed-key GETs.

Counts and leads are read-modify-write. At this volume, concurrent
writes are rare and a lost increment is acceptable; form submissions
are additionally always written to the Vercel function log by the site
(existing fallback in `src/lib/leads.ts`).

## Endpoints

All require header `x-opp-key: <OPP_SHARED_SECRET>` except `/health`.

- `GET /health` → `{ ok: true }`
- `POST /track` — body `{ t, p, did? }` (same payload the site's
  `/api/track` already validates; types: `pv`, `tel`, `form_start`,
  `form_submit`). Returns `{ ok, counted }` — `counted: false` when the
  `did` was already seen inside the dedupe window.
- `POST /lead` — body is one lead object (`name`, `phone`, `service`,
  `city`, `message`, `source`, `submittedAt`). Appends to `opp:leads`.
- `GET /read?days=30` (1–35) → `{ generatedAt, days, leads, leadsTotal }`.
  **This is how we read the data back** — from any machine:
  `curl -H "x-opp-key: <secret>" https://<worker-url>/read`

Bot filtering stays where it belongs: the site's `/api/track` filters
by user-agent before forwarding, and this Worker is only ever called
server-to-server with the secret.

## Site-side integration

- `src/lib/cf-store.ts` — committed Worker URL + secret + fetch helpers.
- `src/pages/api/track.js` — after bot filtering, forwards events to
  `POST /track`; on any Worker failure it falls back to the existing
  Vercel KV path, so nothing regresses if the Worker is down.
- `src/lib/leads.ts` (`storeLead`) — tries `POST /lead` first, falls
  back to the KV pipeline, then to the function-log record, exactly as
  before.
- `src/pages/dash-v9x4qm2k.astro` — reads from `GET /read` when the
  Worker is configured (KV path kept as fallback), and the dashboard
  gate now also accepts the shared secret as `?k=` when `DASHBOARD_TOKEN`
  is unset — otherwise the dashboard stays unreachable for the same
  reason KV was: its token env var can't be set either.

## Secret rotation

The shared secret lives in exactly two committed places:
`wrangler.toml` (`[vars] OPP_SHARED_SECRET`) and `src/lib/cf-store.ts`
(`CF_STORE_SECRET`). To rotate: pick a new value, edit both, run
`npx wrangler deploy` here, and `git push` the site change (the
git-connected Vercel deploy applies it). No dashboard in the loop.

## Go-live (one-time)

1. Mint a Workers-scoped Cloudflare API token in the signed-in
   dashboard (My Profile → API Tokens → custom token: Account →
   Workers Scripts → Edit, Account → Workers KV Storage → Edit,
   scoped to Dejan's account). Set it as `CLOUDFLARE_API_TOKEN`
   (and `CLOUDFLARE_ACCOUNT_ID`) in the shell — never commit it.
2. `cd workers/opp-store && npm install`
3. `npx wrangler kv namespace create OPP_KV` → paste the printed `id`
   over both placeholder ids in `wrangler.toml`. (Create the preview
   namespace too if you want `wrangler dev` against remote preview;
   local `wrangler dev` works without it.)
4. `npx wrangler deploy` → note the printed `*.workers.dev` URL.
5. Put that URL into `CF_STORE_URL` in `src/lib/cf-store.ts` (one line)
   and commit/push — if it differs from what's committed, the site
   keeps using its KV fallback until this lands, so order is safe.
6. Merge the PR that introduced this Worker → Vercel git-deploy ships
   the site side automatically.
7. Smoke test: `curl https://<worker-url>/health`, load a site page,
   then `curl -H "x-opp-key: <secret>" https://<worker-url>/read` and
   confirm the pageview counter appears.

## Local test

`npm test` runs `test/local-test.mjs` — plain Node against a fake KV
binding that deliberately has no `list()` method (any list call would
crash the harness), covering auth, counting, dedupe, lead append +
1,000 cap, TTLs, and read-back.
