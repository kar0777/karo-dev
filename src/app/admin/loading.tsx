import { AdminPageSkeleton } from '@/components/admin/page-skeleton';

export default function AdminOverviewLoading() {
  return <AdminPageSkeleton stats={4} rows={6} chart />;
}
