import type { MetadataRoute } from 'next';
import { absoluteUrl, siteConfig } from '@/lib/metadata';

/**
 * Crawl policy.
 *
 * Everything behind authentication is disallowed outright — those routes
 * also send `Cache-Control: private, no-store` from `next.config.ts`, so
 * this is belt and braces rather than the only protection. `/api/` is
 * excluded because route handlers exist for mutations, streaming and
 * client-side polling, never for indexable content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/', '/admin/', '/api/'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: siteConfig.url,
  };
}
