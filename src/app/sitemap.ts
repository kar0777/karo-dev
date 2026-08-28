import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/metadata';

type Route = {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  priority: number;
};

/**
 * Public surface only. Authenticated routes are excluded here and
 * disallowed in `robots.ts`; they would 302 to the login page for a
 * crawler anyway.
 *
 * Priorities are relative: the landing page and pricing convert, docs
 * and features support the decision, legal pages exist to be findable.
 */
const PUBLIC_ROUTES: readonly Route[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/features', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/docs', changeFrequency: 'daily', priority: 0.8 },
  { path: '/security', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/login', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/register', changeFrequency: 'yearly', priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  // One timestamp for the whole document: these pages ship together, and
  // per-entry drift would only make the file churn on every request.
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
