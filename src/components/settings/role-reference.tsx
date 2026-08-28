import { Check, Minus } from 'lucide-react';

import type { TeamRole } from '@/lib/db/schema';
import {
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  TEAM_ROLES,
  can,
  type Permission,
} from '@/lib/rbac/permissions';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * What each role actually means, generated from `ROLE_PERMISSIONS` rather than
 * written by hand — a permission added to a role shows up here automatically
 * instead of quietly making this table a lie.
 */

/** The permissions worth a column: the ones people argue about. */
const HIGHLIGHTED: Permission[] = [
  'project.create',
  'agent.run',
  'terminal.use',
  'sandbox.destroy',
  'apikey.manage',
  'worker.manage',
  'team.invite',
  'billing.manage',
];

export function RoleReference({ currentRole }: { currentRole: TeamRole }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What each role can do</CardTitle>
        <CardDescription>
          Roles are cumulative — each one includes everything below it. The server enforces this
          on every request, not just in the interface.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 px-0 pb-0">
        <ul className="space-y-2 px-4">
          {TEAM_ROLES.map((role) => (
            <li key={role} className="flex flex-wrap items-baseline gap-2">
              <Badge size="sm" variant={role === currentRole ? 'primary' : 'outline'}>
                {ROLE_LABELS[role]}
                {role === currentRole ? ' · you' : ''}
              </Badge>
              <span className="text-[12.5px] text-muted">{ROLE_DESCRIPTIONS[role]}</span>
            </li>
          ))}
        </ul>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Permission</TableHead>
              {TEAM_ROLES.map((role) => (
                <TableHead key={role} className="text-center">
                  {ROLE_LABELS[role]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {HIGHLIGHTED.map((permission) => (
              <TableRow key={permission}>
                <TableCell className="text-muted">{PERMISSIONS[permission]}</TableCell>
                {TEAM_ROLES.map((role) => (
                  <TableCell key={role} className="text-center">
                    {can(role, permission) ? (
                      <>
                        <Check className="mx-auto size-3.5 text-primary" aria-hidden="true" />
                        <span className="sr-only">Allowed</span>
                      </>
                    ) : (
                      <>
                        <Minus className="mx-auto size-3.5 text-subtle" aria-hidden="true" />
                        <span className="sr-only">Not allowed</span>
                      </>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
