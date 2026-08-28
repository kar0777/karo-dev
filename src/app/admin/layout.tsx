import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ne } from 'drizzle-orm';

import { AdminShell } from '@/components/admin/admin-shell';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { incidents } from '@/lib/db/schema';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * `/admin` is never linked from the product and never indexed. The guard below
 * answers 404 for everyone who is not a platform admin, so the console is not
 * discoverable by probing either.
 */
export const metadata: Metadata = {
  title: 'Karo Admin',
  robots: { index: false, follow: false },
};

async function openIncidentCount(): Promise<number> {
  try {
    const rows = await db
      .select({ id: incidents.id })
      .from(incidents)
      .where(ne(incidents.status, 'resolved'))
      .limit(50);
    return rows.length;
  } catch {
    // A badge is not worth failing the whole console over.
    return 0;
  }
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requirePlatformAdmin();
  const openIncidents = await openIncidentCount();

  return (
    <AdminShell
      adminEmail={user.email}
      adminName={user.name}
      demoMode={env.DEMO_MODE}
      openIncidents={openIncidents}
    >
      {children}
    </AdminShell>
  );
}
