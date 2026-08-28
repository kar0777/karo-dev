'use client';

import { Plus, Power } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { formatMicroUsd } from '@/lib/utils';

/**
 * Admin → Coupons. Create a code, hand it to someone, watch the redemption
 * count tick up, retire it when done. Redemption itself happens in Billing —
 * this screen only mints and manages.
 */

export type AdminCoupon = {
  id: string;
  code: string;
  name: string;
  kind: 'credit' | 'plan_discount';
  amountMicroUsd: number;
  creditFor: string;
  percentOff: number | null;
  planTier: string | null;
  maxRedemptions: number;
  maxPerTeam: number;
  expiresAt: string | null;
  isActive: boolean;
  redemptionCount: number;
  createdBy: string;
  createdAt: string;
};

export function CouponsManager({ coupons }: { coupons: AdminCoupon[] }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: '',
    code: '',
    kind: 'credit' as 'credit' | 'plan_discount',
    amountUsd: '25',
    creditFor: 'any',
    percentOff: '50',
    planTier: 'lite',
    maxRedemptions: '1',
    maxPerTeam: '1',
    expiresAt: '',
  });

  async function create() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        kind: form.kind,
        maxRedemptions: Number(form.maxRedemptions) || 1,
        maxPerTeam: Number(form.maxPerTeam) || 1,
        creditFor: form.creditFor,
      };
      if (form.kind === 'credit') {
        body.amountUsd = Number(form.amountUsd) || 0;
      } else {
        body.percentOff = Number(form.percentOff) || 0;
        body.planTier = form.planTier;
      }
      if (form.expiresAt) body.expiresAt = new Date(form.expiresAt).toISOString();

      const result = await apiFetch<{ coupon: { code: string } }>('/api/admin/coupons', {
        method: 'POST',
        json: body,
      });
      toast.success(`Coupon ${result.coupon.code} created`, {
        description: 'Hand the code to its recipient — they redeem it in Billing.',
      });
      setForm((current) => ({ ...current, name: '', code: '' }));
      setCreating(false);
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(coupon: AdminCoupon) {
    try {
      await apiFetch(`/api/admin/coupons/${coupon.id}`, {
        method: 'PATCH',
        json: { isActive: !coupon.isActive },
      });
      toast.success(coupon.isActive ? `Coupon ${coupon.code} retired` : `Coupon ${coupon.code} re-armed`);
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {coupons.length} code{coupons.length === 1 ? '' : 's'}
        </p>
        <Button size="sm" iconLeft={<Plus />} onClick={() => setCreating((value) => !value)}>
          {creating ? 'Close' : 'New coupon'}
        </Button>
      </div>

      {creating ? (
        <form
          className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="coupon-name">What it is for</FieldLabel>
            <Input
              id="coupon-name"
              required
              placeholder="Conference giveaway — $25 of agent time"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="coupon-kind">Kind</FieldLabel>
            <Select
              value={form.kind}
              onValueChange={(value) => setForm({ ...form, kind: value as typeof form.kind })}
            >
              <SelectTrigger id="coupon-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">Bonus balance (tokens / compute)</SelectItem>
                <SelectItem value="plan_discount">Percent off a plan</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="coupon-code">Code (empty = generate)</FieldLabel>
            <Input
              id="coupon-code"
              placeholder="KARO-XXXX-XXXX"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>

          {form.kind === 'credit' ? (
            <>
              <Field>
                <FieldLabel htmlFor="coupon-amount">Amount, $</FieldLabel>
                <Input
                  id="coupon-amount"
                  inputMode="decimal"
                  value={form.amountUsd}
                  onChange={(event) => setForm({ ...form, amountUsd: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="coupon-for">Credit meant for</FieldLabel>
                <Select
                  value={form.creditFor}
                  onValueChange={(value) => setForm({ ...form, creditFor: value })}
                >
                  <SelectTrigger id="coupon-for">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Anything</SelectItem>
                    <SelectItem value="tokens">AI tokens</SelectItem>
                    <SelectItem value="compute">Compute hours</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="coupon-percent">Percent off</FieldLabel>
                <Input
                  id="coupon-percent"
                  inputMode="numeric"
                  value={form.percentOff}
                  onChange={(event) => setForm({ ...form, percentOff: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="coupon-tier">Plan</FieldLabel>
                <Select
                  value={form.planTier}
                  onValueChange={(value) => setForm({ ...form, planTier: value })}
                >
                  <SelectTrigger id="coupon-tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['lite', 'pro', 'scale', 'ultra'].map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {tier}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          <Field>
            <FieldLabel htmlFor="coupon-max">Total activations</FieldLabel>
            <Input
              id="coupon-max"
              inputMode="numeric"
              value={form.maxRedemptions}
              onChange={(event) => setForm({ ...form, maxRedemptions: event.target.value })}
            />
            <FieldHint>Across all accounts.</FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="coupon-per-team">Per workspace</FieldLabel>
            <Input
              id="coupon-per-team"
              inputMode="numeric"
              value={form.maxPerTeam}
              onChange={(event) => setForm({ ...form, maxPerTeam: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="coupon-expires">Expires (optional)</FieldLabel>
            <Input
              id="coupon-expires"
              type="datetime-local"
              value={form.expiresAt}
              onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
            />
          </Field>

          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" loading={busy} iconLeft={<Plus />}>
              Create coupon
            </Button>
          </div>
        </form>
      ) : null}

      {coupons.length > 0 ? (
        <Table containerClassName="rounded-lg border border-line bg-surface">
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Redeemed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coupons.map((coupon) => (
              <TableRow key={coupon.id}>
                <TableCell>
                  <span className="karo-numeric font-medium text-fg">{coupon.code}</span>
                  <span className="block text-[11.5px] text-subtle">{coupon.name}</span>
                </TableCell>
                <TableCell className="karo-numeric text-[12.5px]">
                  {coupon.kind === 'credit'
                    ? `${formatMicroUsd(coupon.amountMicroUsd)} (${coupon.creditFor})`
                    : `${coupon.percentOff}% off ${coupon.planTier}`}
                </TableCell>
                <TableCell className="karo-numeric text-[12.5px]">
                  {coupon.redemptionCount} / {coupon.maxRedemptions}
                  <span className="block text-[11.5px] text-subtle">
                    ≤{coupon.maxPerTeam} per workspace
                  </span>
                </TableCell>
                <TableCell>
                  {coupon.isActive ? (
                    <Badge variant="primary" size="sm">
                      Active
                    </Badge>
                  ) : (
                    <Badge size="sm">Retired</Badge>
                  )}
                  {coupon.expiresAt && coupon.expiresAt < new Date().toISOString() ? (
                    <Badge variant="neutral" size="sm">
                      Expired
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<Power />}
                    onClick={() => void toggle(coupon)}
                  >
                    {coupon.isActive ? 'Retire' : 'Re-arm'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
