# Orlando Pest Pros

Independent pest-control quote-request website for Osceola and Orange Counties, Florida. Astro + Tailwind, deployed on Vercel. This website does not perform pest treatments or claim a storefront, provider license, customer reviews, or employed technicians.

## Development

Use Node 24: `npm ci`, `npm test`, `npm run build`, `npm run dev`.
Pages are data-driven from `src/data/*.json`. The old assembly script depends on external `/tmp/copy/` source files and may overwrite reviewed copy; do not regenerate blindly.

## Lead capture

Set a complete runtime credential pair in Vercel: `KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Quote submissions succeed only after Redis confirms persistence. Missing configuration, HTTP failures, or Redis command errors return a retryable failure. Personal lead data is not logged.

Leads are stored in `opp:leads`, capped at the newest 1,000 records. Arrange a recipient and follow-up process; storage alone does not notify a provider. The dashboard requires `DASHBOARD_TOKEN`; `/dash-v9x4qm2k?token=...` shows stored inquiries and 30-day analytics. Treat its token as a secret and do not share its URL.

## Measurement

Accepted form leads are counted server-side after storage. Browser events count pageviews, form starts, and phone-link clicks. Phone clicks are not completed calls. Session first-touch attribution distinguishes organic, paid, referral, direct, and unknown; it is referrer-based evidence, not verified search-ranking data. Raw referrer URLs and query strings are not stored. Historical submission-attempt counters are excluded from accepted-lead totals.

## Contact and SEO setup

Optional build-time `PUBLIC_TRACKING_PHONE_NUMBER` must be a real routed US number. Invalid and 555 numbers are disabled; visitors use the quote form instead. No number is required for form lead capture.

Keep the production origin aligned in `src/config.ts`, `astro.config.mjs`, and `public/robots.txt`. Add genuine Search Console/Bing verification tokens only after account verification. Use [the launch checklist](docs/SEO-LAUNCH.md) to verify production storage, deployment, indexing, and lead attribution. Time alone cannot resolve missing configuration or guarantee rankings.
