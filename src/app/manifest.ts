import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/metadata';

/**
 * Web app manifest.
 *
 * Installed instances open straight into the product shell rather than
 * the marketing site — someone who installed Karo wants their projects,
 * not the pitch. `scope` stays at the root so the marketing pages and
 * auth flow still resolve inside the installed window.
 *
 * `theme_color` and `background_color` are the literal values of
 * `--k-bg` in the dark theme, which is Karo's default.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/app',
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.shortDescription,
    lang: 'en',
    dir: 'ltr',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#0d0b09',
    theme_color: '#0d0b09',
    categories: ['developer', 'productivity', 'utilities'],
    prefer_related_applications: false,
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/apple-icon.svg',
        sizes: '180x180',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Projects',
        short_name: 'Projects',
        description: 'Open the project list',
        url: '/app/projects',
      },
      {
        name: 'Sandboxes',
        short_name: 'Sandboxes',
        description: 'Inspect running and sleeping sandboxes',
        url: '/app/sandboxes',
      },
      {
        name: 'Usage',
        short_name: 'Usage',
        description: 'Weighted tokens, compute hours and spend',
        url: '/app/usage',
      },
    ],
  };
}
