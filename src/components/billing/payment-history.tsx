import { Download, ExternalLink, FileText } from 'lucide-react';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatMicroUsd } from '@/lib/utils';

/** Invoices and top-ups — the two records people go looking for at month end. */

export type InvoiceRow = {
  id: string;
  number: string;
  status: string;
  totalMicroUsd: number;
  amountPaidMicroUsd: number;
  periodStartIso: string | null;
  periodEndIso: string | null;
  issuedAtIso: string | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
};

export type TopupRow = {
  id: string;
  amountMicroUsd: number;
  bonusMicroUsd: number;
  status: string;
  provider: string;
  createdAtIso: string;
  completedAtIso: string | null;
  failureReason: string | null;
};

function invoiceVariant(status: string): BadgeProps['variant'] {
  switch (status) {
    case 'paid':
      return 'success';
    case 'open':
      return 'warning';
    case 'uncollectible':
      return 'danger';
    case 'void':
      return 'neutral';
    default:
      return 'outline';
  }
}

function topupVariant(status: string): BadgeProps['variant'] {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'pending':
      return 'warning';
    case 'refunded':
      return 'info';
    default:
      return 'danger';
  }
}

export interface PaymentHistoryProps {
  invoices: readonly InvoiceRow[];
  topups: readonly TopupRow[];
}

export function PaymentHistory({ invoices, topups }: PaymentHistoryProps) {
  return (
    <section
      aria-labelledby="payment-history-title"
      className="rounded-lg border border-line bg-surface shadow-sm"
    >
      <header className="border-b border-line px-4 py-3">
        <h2 id="payment-history-title" className="text-sm leading-tight font-semibold text-fg">
          Payment history
        </h2>
        <p className="mt-1 text-[12px] text-muted">
          Invoices and balance top-ups for this team, newest first.
        </p>
      </header>

      <div className="border-b border-line">
        <h3 className="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
          Invoices
        </h3>
        {invoices.length === 0 ? (
          <EmptyState
            size="sm"
            icon={FileText}
            title="No invoices yet"
            description="An invoice is issued for each subscription period and each balance top-up."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Document</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-[12px] text-fg">
                    {invoice.number}
                  </TableCell>
                  <TableCell className="karo-numeric whitespace-nowrap text-muted">
                    {invoice.issuedAtIso ? formatDate(invoice.issuedAtIso) : '—'}
                  </TableCell>
                  <TableCell className="karo-numeric whitespace-nowrap text-muted">
                    {invoice.periodStartIso && invoice.periodEndIso
                      ? `${formatDate(invoice.periodStartIso)} → ${formatDate(invoice.periodEndIso)}`
                      : 'One-off'}
                  </TableCell>
                  <TableCell className="karo-numeric text-right font-medium text-fg">
                    {formatMicroUsd(invoice.totalMicroUsd)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={invoiceVariant(invoice.status)} size="sm">
                      {invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {invoice.pdfUrl ? (
                      <a
                        href={invoice.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-sm text-primary transition-colors duration-150 hover:underline"
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        PDF
                      </a>
                    ) : invoice.hostedInvoiceUrl ? (
                      <a
                        href={invoice.hostedInvoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-sm text-primary transition-colors duration-150 hover:underline"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        View
                      </a>
                    ) : (
                      <span className="text-[11px] text-subtle">Simulated — no document</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
          Top-ups
        </h3>
        {topups.length === 0 ? (
          <EmptyState
            size="sm"
            icon={FileText}
            title="No top-ups yet"
            description="Credit you add to the pay-as-you-go balance is listed here with its receipt."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Bonus</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topups.map((topup) => (
                <TableRow key={topup.id}>
                  <TableCell className="karo-numeric whitespace-nowrap text-muted">
                    {formatDate(topup.completedAtIso ?? topup.createdAtIso)}
                  </TableCell>
                  <TableCell className="karo-numeric text-right font-medium text-ember">
                    {formatMicroUsd(topup.amountMicroUsd)}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    {topup.bonusMicroUsd > 0 ? formatMicroUsd(topup.bonusMicroUsd) : '—'}
                  </TableCell>
                  <TableCell className="text-muted">
                    {topup.provider === 'mock' ? 'Simulated' : 'Card'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={topupVariant(topup.status)} size="sm">
                      {topup.status}
                    </Badge>
                    {topup.failureReason ? (
                      <span className="mt-0.5 block text-[11px] text-danger">
                        {topup.failureReason}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
