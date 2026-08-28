import Link from 'next/link';
import { ArrowLeft, LayoutGrid, LifeBuoy } from 'lucide-react';
import { DiamondAccent, LatticeBackdrop } from '@/components/brand/lattice';
import { KaroLogo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
      <LatticeBackdrop fade="top" opacity={70} />

      <Link
        href="/"
        className="absolute top-6 left-6 rounded-md transition-opacity hover:opacity-80"
        aria-label="Karo home"
      >
        <KaroLogo size={22} />
      </Link>

      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <DiamondAccent size={8} tone="line" outline />
          <span className="font-mono text-xs tracking-[0.2em] text-subtle uppercase">
            Error 404
          </span>
          <DiamondAccent size={8} tone="line" outline />
        </div>

        <p className="karo-numeric text-7xl leading-none font-semibold tracking-tight text-fg sm:text-8xl">
          404
        </p>

        <h1 className="mt-6 text-xl font-semibold tracking-tight text-fg">
          This page doesn&rsquo;t exist
        </h1>
        <p className="mt-2 text-sm text-muted">
          It may have moved or been deleted. If you followed a link from inside Karo, the
          resource was probably renamed — open your dashboard and search for it there.
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button asChild variant="primary" size="md" className="w-full sm:w-auto">
            <Link href="/">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to home
            </Link>
          </Button>
          <Button asChild variant="outline" size="md" className="w-full sm:w-auto">
            <Link href="/app">
              <LayoutGrid className="size-4" aria-hidden="true" />
              Go to dashboard
            </Link>
          </Button>
        </div>

        <p className="mt-8 text-xs text-subtle">
          <LifeBuoy className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden="true" />
          Still stuck? Check the{' '}
          <Link
            href="/docs"
            className="text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
          >
            documentation
          </Link>{' '}
          or{' '}
          <a
            href="mailto:support@karo.dev"
            className="text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
          >
            email support
          </a>
          .
        </p>
      </div>
    </main>
  );
}
