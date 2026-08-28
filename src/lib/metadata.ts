import type { Metadata, Viewport } from 'next';
import { env } from '@/lib/env';

/* ------------------------------------------------------------------ *
 *  Site identity and page metadata
 *
 *  Every route builds its `<head>` through `buildMetadata()` so that
 *  canonical URLs, Open Graph cards and robots directives stay
 *  consistent, and so a single change to `APP_URL` propagates
 *  everywhere.
 * ------------------------------------------------------------------ */

/** Falls back to localhost so `next build` succeeds with an empty env. */
function resolveSiteUrl(): string {
  const raw = env.APP_URL || 'http://localhost:3000';
  try {
    // Strip any trailing slash so `${url}${path}` never doubles up.
    return new URL(raw).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

export const siteConfig = {
  name: 'Karo',
  tagline: 'Build anything with an AI agent that has a real computer.',
  description:
    'Karo gives an AI coding agent a sandboxed Linux machine of its own. It reads and writes your project files, runs real shell commands, connects MCP servers, installs skills and plugins — and every token and compute-second is metered, so you always know what a task cost.',
  /** Short form for cards, meta descriptions and app-store style listings. */
  shortDescription:
    'A cloud workspace where an AI agent runs real commands on a real sandboxed machine — metered to the token.',
  url: resolveSiteUrl(),
  ogImage: '/opengraph-image',
  locale: 'en_US',
  keywords: [
    'AI coding agent',
    'cloud development environment',
    'sandboxed Linux VM',
    'agentic coding',
    'MCP servers',
    'Model Context Protocol',
    'AI pair programmer',
    'remote dev sandbox',
    'agent skills',
    'token metering',
    'usage-based billing',
    'devtools',
  ],
  /** Public contact surfaces. Kept here so footers and JSON-LD agree. */
  contact: {
    support: 'support@karo.dev',
    security: 'security@karo.dev',
  },
  social: {
    twitter: '@karodev',
  },
} as const;

export type SiteConfig = typeof siteConfig;

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path = '/'): string {
  return `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;
}

export type BuildMetadataOptions = {
  /** Page title without the suffix — the `%s · Karo` template adds it. */
  title?: string;
  description?: string;
  /** Site-relative path used for the canonical URL, e.g. `/pricing`. */
  path?: string;
  /** Authenticated, transactional and duplicate surfaces set this. */
  noIndex?: boolean;
  /** Override the social card. Defaults to the generated OG image. */
  image?: string;
  /** `article` for docs and changelog entries. */
  type?: 'website' | 'article';
};

/**
 * Builds a complete `Metadata` object for a route.
 *
 * Called with no arguments by the root layout, where it emits the title
 * template and the site-wide defaults; called with a title by every
 * page, where the template is applied by Next.
 */
export function buildMetadata(options: BuildMetadataOptions = {}): Metadata {
  const { title, description, path = '/', noIndex = false, image, type = 'website' } = options;

  const resolvedDescription = description ?? siteConfig.description;
  const canonical = path;
  const ogImageUrl = image ?? siteConfig.ogImage;
  const socialTitle = title
    ? `${title} · ${siteConfig.name}`
    : `${siteConfig.name} — ${siteConfig.tagline}`;

  return {
    metadataBase: new URL(siteConfig.url),
    title: title
      ? title
      : {
          default: `${siteConfig.name} — ${siteConfig.tagline}`,
          template: `%s · ${siteConfig.name}`,
        },
    description: resolvedDescription,
    applicationName: siteConfig.name,
    keywords: [...siteConfig.keywords],
    authors: [{ name: siteConfig.name, url: siteConfig.url }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    referrer: 'strict-origin-when-cross-origin',
    // Phone-number autolinking mangles port numbers and IDs in our copy.
    formatDetection: { telephone: false, address: false, email: false },
    alternates: {
      canonical,
    },
    openGraph: {
      type,
      siteName: siteConfig.name,
      title: socialTitle,
      description: resolvedDescription,
      url: canonical,
      locale: siteConfig.locale,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${siteConfig.name} — ${siteConfig.tagline}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description: resolvedDescription,
      site: siteConfig.social.twitter,
      creator: siteConfig.social.twitter,
      images: [ogImageUrl],
    },
    icons: {
      icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
      apple: [{ url: '/apple-icon.svg', sizes: '180x180', type: 'image/svg+xml' }],
    },
    manifest: '/manifest.webmanifest',
    robots: noIndex
      ? {
          index: false,
          follow: false,
          nocache: true,
          googleBot: { index: false, follow: false },
        }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-video-preview': -1,
            'max-image-preview': 'large',
            'max-snippet': -1,
          },
        },
  };
}

/** Root-layout metadata. Exported so `layout.tsx` stays declarative. */
export const metadata: Metadata = buildMetadata();

/**
 * Theme colours match `--k-bg` in each scheme so the browser chrome on
 * mobile blends into the page instead of banding against it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0b09' },
  ],
};

/* ------------------------------------------------------------------ *
 *  JSON-LD
 * ------------------------------------------------------------------ */

type JsonLd = Record<string, unknown>;

/** Schema.org `Organization` describing the company behind Karo. */
export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteConfig.url}/#organization`,
    name: siteConfig.name,
    url: siteConfig.url,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl('/icon.svg'),
      width: 32,
      height: 32,
    },
    description: siteConfig.shortDescription,
    sameAs: [`https://twitter.com/${siteConfig.social.twitter.replace('@', '')}`],
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: siteConfig.contact.support,
        availableLanguage: ['English', 'Russian'],
      },
      {
        '@type': 'ContactPoint',
        contactType: 'security',
        email: siteConfig.contact.security,
        availableLanguage: ['English'],
      },
    ],
  };
}

/**
 * Schema.org `SoftwareApplication`.
 *
 * `offers` intentionally advertises only the free entry point: concrete
 * plan pricing lives in the `plans` table and must never be duplicated
 * as a literal here.
 */
export function softwareApplicationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${siteConfig.url}/#software`,
    name: siteConfig.name,
    url: siteConfig.url,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Integrated Development Environment',
    operatingSystem: 'Web browser',
    description: siteConfig.description,
    image: absoluteUrl(siteConfig.ogImage),
    softwareHelp: { '@type': 'CreativeWork', url: absoluteUrl('/docs') },
    featureList: [
      'AI agent with a dedicated sandboxed Linux machine',
      'Real shell execution with command-safety review',
      'Project file editing with reviewable diffs',
      'Model Context Protocol server connections',
      'Installable agent skills and plugins',
      'Per-token and per-compute-second metering',
    ],
    offers: {
      '@type': 'Offer',
      category: 'free',
      price: '0',
      priceCurrency: 'USD',
      url: absoluteUrl('/pricing'),
    },
    publisher: { '@id': `${siteConfig.url}/#organization` },
  };
}

/** Schema.org `WebSite` — enables sitelinks search in results. */
export function webSiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteConfig.url}/#website`,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.shortDescription,
    inLanguage: 'en',
    publisher: { '@id': `${siteConfig.url}/#organization` },
  };
}

/**
 * All site-wide JSON-LD documents, ready to be serialised into a single
 * `<script type="application/ld+json">` in the root layout.
 */
export function structuredData(): JsonLd[] {
  return [organizationJsonLd(), softwareApplicationJsonLd(), webSiteJsonLd()];
}
