# Orlando Pest Pros

Independent pest-control quote-request website for Osceola and Orange Counties, Florida. Astro + Tailwind, fully static, deployed to GitHub Pages (`.github/workflows/deploy-pages.yml`, custom domain via `public/CNAME`). This website does not perform pest treatments or claim a storefront, provider license, customer reviews, or employed technicians.

## Development

Use Node 24: `npm ci`, `npm test`, `npm run check:runtime`, `npm run build`, `npm run dev`.
Pages are data-driven from `src/data/*.json`. The old assembly script depends on external `/tmp/copy/` source files and may overwrite reviewed copy; do not regenerate blindly.

## Lead capture

The quote form posts cross-origin to the owner's Cloudflare Worker at `https://osceolasodsolutions.top/api/contact` (`LEAD_ENDPOINT` in `src/config.ts`). The Worker allowlists this origin (CORS), stores the lead tagged `site: orlandopestcontrol.top`, assigns it to the owner only and sends the owner SMS alert. Without JavaScript the plain POST redirects back to `/thank-you/`. Test submissions must include `test=1` so they are stored as synthetic and never alert. No env vars or secrets are needed to build this site.

The old Vercel/Upstash path (`/api/quote`, `opp:leads`, private dashboard) is removed; rows already in Upstash are untouched.

## Measurement

Browser attribution (`public/track.js`) is local only and makes no network requests; its session first-touch channel is sent with the quote form.

## Contact and SEO setup

Optional build-time `PUBLIC_TRACKING_PHONE_NUMBER` must be a real routed US number. Invalid and 555 numbers are disabled; visitors use the quote form instead. No number is required for form lead capture.

Keep the production origin aligned in `src/config.ts`, `astro.config.mjs`, and `public/robots.txt`. Add genuine Search Console/Bing verification tokens only after account verification. Use [the launch checklist](docs/SEO-LAUNCH.md) to verify production storage, deployment, indexing, and lead attribution. Time alone cannot resolve missing configuration or guarantee rankings.

## Static guardrails

`npm run check:runtime` fails if any page opts out of prerendering, an `/api` route returns, or middleware is added: GitHub Pages serves static files only.
