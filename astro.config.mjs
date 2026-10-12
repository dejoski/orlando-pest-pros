import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// Production origin must match src/config.ts and public/robots.txt.
export default defineConfig({
  site: 'https://orlandopestcontrol.top',
  trailingSlash: 'always',
  // NOTE: Astro 5.18+ removed output:"hybrid" — "static" (default) now
  // behaves the same: pages prerender, routes with `prerender = false`
  // (/api/*, dashboard) run as Vercel serverless functions via the adapter.
  adapter: vercel(),
  vite: { plugins: [tailwindcss()] },
  integrations: [
    // Private analytics dashboard must never appear in the sitemap.
    // Priority follows research/market-research.md §6 (10-page launch list):
    // quick-win city pages + high-value service pages rank first.
    sitemap({
      filter: (page) => !page.includes("dash-v9x4qm2k") && !page.includes("thank-you"),
      serialize(item) {
        const url = new URL(item.url);
        const path = url.pathname;
        const LAUNCH_CITIES = [
          "intercession-city", "campbell", "championsgate",
          "poinciana", "kissimmee", "st-cloud", "orlando",
        ];
        const LAUNCH_SERVICES = ["termite-control", "mosquito-control", "wildlife-removal"];
        let priority = 0.5;
        if (path === "/") priority = 1.0;
        else if (/^\/locations\/[^/]+\/$/.test(path)) {
          const city = path.split("/")[2];
          priority = LAUNCH_CITIES.includes(city) ? 0.9 : 0.7;
        } else if (/^\/services\/[^/]+\/$/.test(path)) {
          const svc = path.split("/")[2];
          priority = LAUNCH_SERVICES.includes(svc) ? 0.9 : 0.7;
        } else if (/^\/locations\/[^/]+\/[^/]+\/$/.test(path)) {
          const city = path.split("/")[2];
          priority = LAUNCH_CITIES.includes(city) ? 0.8 : 0.6;
        }
        return { ...item, priority };
      },
    }),
  ],
});

