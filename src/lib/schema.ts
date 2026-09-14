import { SITE_NAME, SITE_URL, PHONE_DISPLAY, PHONE_TEL, SERVICE_AREA, COUNTIES } from "../config";

export interface Faq { q: string; a: string }
export interface Crumb { name: string; url: string }

const abs = (path: string) => `${SITE_URL}${path}`;

export function localBusinessSchema(opts: {
  url: string;
  areaServed: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "PestControlService",
    "@id": abs("/#business"),
    name: SITE_NAME,
    url: abs(opts.url),
    telephone: PHONE_TEL,
    areaServed: [
      ...COUNTIES.map((c) => ({ "@type": "AdministrativeArea", name: c })),
      ...opts.areaServed.map((a) => ({ "@type": "City", name: a })),
    ],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Kissimmee",
      addressRegion: "FL",
      addressCountry: "US",
    },
    openingHours: "Mo-Sa 07:00-19:00",
    priceRange: "$$",
  };
}

export function serviceSchema(service: { name: string; description: string; url: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.name,
    description: service.description,
    url: abs(service.url),
    provider: { "@id": abs("/#business") },
    areaServed: { "@type": "AdministrativeArea", name: SERVICE_AREA },
  };
}

export function faqSchema(faqs: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function breadcrumbSchema(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: abs(c.url),
    })),
  };
}

/** Render one or more JSON-LD blocks. */
export function jsonLd(...blocks: unknown[]) {
  return blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join("\n");
}
