import { absoluteUrl, siteConfig } from '@/lib/metadata';

/**
 * Structured data helpers for the public pages.
 *
 * The root layout already emits Organization, WebSite and
 * SoftwareApplication. Everything here is *page* scoped: FAQ entries,
 * breadcrumb trails and the landing page's product record.
 */

type JsonLd = Record<string, unknown>;

export function JsonLd({ data }: { data: JsonLd | JsonLd[] }) {
  return (
    <script
      type="application/ld+json"
      // Serialised from typed objects authored in this repo — no user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export type FaqEntry = { question: string; answer: string };

export function faqPageJsonLd(entries: readonly FaqEntry[], path: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${absoluteUrl(path)}#faq`,
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}

export function breadcrumbJsonLd(trail: ReadonlyArray<{ name: string; path: string }>): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: siteConfig.name,
        item: absoluteUrl('/'),
      },
      ...trail.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 2,
        name: crumb.name,
        item: absoluteUrl(crumb.path),
      })),
    ],
  };
}

/** `WebPage` record for a documentation or policy page. */
export function webPageJsonLd(options: {
  name: string;
  description: string;
  path: string;
  type?: 'WebPage' | 'TechArticle' | 'AboutPage';
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': options.type ?? 'WebPage',
    '@id': `${absoluteUrl(options.path)}#page`,
    name: options.name,
    description: options.description,
    url: absoluteUrl(options.path),
    isPartOf: { '@id': `${siteConfig.url}/#website` },
    publisher: { '@id': `${siteConfig.url}/#organization` },
    inLanguage: 'en',
  };
}
