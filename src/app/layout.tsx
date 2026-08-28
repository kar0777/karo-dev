import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toast';
import {
  metadata as karoMetadata,
  structuredData,
  viewport as karoViewport,
} from '@/lib/metadata';
import { cn } from '@/lib/utils';
import './globals.css';

/**
 * Inter carries the whole UI. Cyrillic is bundled because Karo ships a
 * Russian dictionary and user content is frequently non-Latin.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
});

/** Terminal, diffs, code blocks, and every rendered number in a table. */
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

export const metadata = karoMetadata;
export const viewport = karoViewport;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      // next-themes writes the theme class onto <html> before hydration.
      suppressHydrationWarning
      className={cn(inter.variable, jetBrainsMono.variable, 'h-full')}
    >
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
          storageKey="karo-theme"
        >
          {children}
          <Toaster />
        </ThemeProvider>

        <script
          type="application/ld+json"
          // Serialised from typed objects we control — no user input reaches this.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
        />
      </body>
    </html>
  );
}
