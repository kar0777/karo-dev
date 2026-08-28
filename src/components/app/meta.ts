import {
  Bot,
  Boxes,
  Clock,
  Cloud,
  Container,
  File,
  FileCode,
  Globe,
  LayoutTemplate,
  Package,
  Plug,
  Send,
  Server,
  Terminal,
} from 'lucide-react';
import type * as React from 'react';

import type { RuntimeTarget, SandboxStatus, ShellKind } from '@/lib/db/schema';
import type { StatusDotStatus } from '@/components/ui/dot';

/**
 * Display metadata for the domain enums the shell renders.
 *
 * Copy lives here rather than inside each component so that "Own server" is
 * described the same way on the projects page, in the create dialog and in the
 * onboarding wizard — including the honest note about what it actually needs.
 */

export type IconComponent = React.ComponentType<{ className?: string }>;

/* ------------------------------------------------------------------ *
 *  Runtime targets
 * ------------------------------------------------------------------ */

export type RuntimeTargetOption = Exclude<RuntimeTarget, 'local'>;

export const RUNTIME_TARGET_OPTIONS: readonly RuntimeTargetOption[] = [
  'karo_cloud',
  'own_server',
  'external_sandbox',
];

export const RUNTIME_TARGET_META: Record<
  RuntimeTarget,
  {
    label: string;
    short: string;
    icon: IconComponent;
    description: string;
    requirement: string;
  }
> = {
  karo_cloud: {
    label: 'Karo Cloud',
    short: 'Cloud',
    icon: Cloud,
    description:
      'We run the sandbox for you. Nothing to install — the machine boots on your first message.',
    requirement: 'Compute is metered against your plan at the rate shown on the Usage page.',
  },
  own_server: {
    label: 'Own server',
    short: 'Own server',
    icon: Server,
    description:
      'Your hardware runs the workload. Karo never opens a port on it — the agent polls outbound.',
    requirement:
      'Needs a registered server: install the worker from API keys → Servers, then pick it here.',
  },
  external_sandbox: {
    label: 'External sandbox',
    short: 'External',
    icon: Container,
    description:
      'A third-party sandbox provider hosts the machine and Karo drives it over their API.',
    requirement: 'Needs provider credentials configured by a platform administrator.',
  },
  local: {
    label: 'Local Docker',
    short: 'Local',
    icon: Container,
    description: 'Containers on the machine running Karo. Development installs only.',
    requirement: 'Needs a reachable Docker socket on the Karo host.',
  },
};

/* ------------------------------------------------------------------ *
 *  Shell
 *
 *  Agent-mode copy is *not* duplicated here — `AGENT_MODE_META` already lives
 *  in `@/lib/agent/policy`, next to the rules it describes.
 * ------------------------------------------------------------------ */

export const SHELL_META: Record<ShellKind, { label: string; description: string }> = {
  bash: { label: 'bash', description: 'The default on every Karo sandbox image.' },
  sh: { label: 'sh', description: 'POSIX shell — for minimal or Alpine-based images.' },
  powershell: { label: 'PowerShell', description: 'Windows servers registered through BYOS.' },
  cmd: { label: 'cmd', description: 'Legacy Windows command prompt.' },
};

/* ------------------------------------------------------------------ *
 *  Sandbox status
 * ------------------------------------------------------------------ */

export const SANDBOX_STATUS_META: Record<
  SandboxStatus,
  { label: string; dot: StatusDotStatus; detail: string }
> = {
  creating: { label: 'Creating', dot: 'pending', detail: 'The machine is being provisioned.' },
  starting: { label: 'Starting', dot: 'pending', detail: 'Booting — usually a few seconds.' },
  running: { label: 'Running', dot: 'live', detail: 'Live and billing compute time.' },
  sleeping: {
    label: 'Sleeping',
    dot: 'sleeping',
    detail: 'Idle and not billing. It wakes on your next command (~4s).',
  },
  stopping: { label: 'Stopping', dot: 'pending', detail: 'Shutting down cleanly.' },
  stopped: { label: 'Stopped', dot: 'off', detail: 'Off. Files are kept until auto-destroy.' },
  failed: {
    label: 'Failed',
    dot: 'error',
    detail: 'The machine could not start. Open it for the provider error.',
  },
  destroyed: { label: 'Destroyed', dot: 'off', detail: 'Released. Workspace files are gone.' },
};

/* ------------------------------------------------------------------ *
 *  Templates
 * ------------------------------------------------------------------ */

/** `icon` on a template seed is a lucide name; this is the whitelist. */
const TEMPLATE_ICONS: Record<string, IconComponent> = {
  file: File,
  'layout-template': LayoutTemplate,
  send: Send,
  'file-code': FileCode,
  plug: Plug,
  globe: Globe,
  clock: Clock,
  terminal: Terminal,
  package: Package,
  bot: Bot,
  boxes: Boxes,
};

export function templateIcon(name: string | undefined): IconComponent {
  return (name && TEMPLATE_ICONS[name]) || File;
}
