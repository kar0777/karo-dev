import {
  Binary,
  Bot,
  Brain,
  Bug,
  Clock,
  Cloud,
  Container,
  Cpu,
  Database,
  File,
  FileCode,
  FlaskConical,
  FolderTree,
  Gauge,
  GitBranch,
  GitPullRequest,
  Globe,
  Hexagon,
  Layers,
  LayoutTemplate,
  MessageCircle,
  Package,
  Plug,
  Rocket,
  Send,
  Server,
  Sparkles,
  Theater,
  Triangle,
  Webhook,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Catalogue rows store an icon *name* so the seed data stays plain JSON.
 * Resolving through an explicit map rather than a dynamic import keeps the
 * icons in the server bundle — a marketplace grid must not wait on 40 lazy
 * chunks before it looks finished.
 */
const ICONS: Record<string, LucideIcon> = {
  binary: Binary,
  bot: Bot,
  brain: Brain,
  bug: Bug,
  clock: Clock,
  cloud: Cloud,
  container: Container,
  cpu: Cpu,
  database: Database,
  file: File,
  'file-code': FileCode,
  'flask-conical': FlaskConical,
  'folder-tree': FolderTree,
  gauge: Gauge,
  'git-branch': GitBranch,
  github: GitPullRequest,
  globe: Globe,
  hexagon: Hexagon,
  layers: Layers,
  'layout-template': LayoutTemplate,
  'message-circle': MessageCircle,
  package: Package,
  plug: Plug,
  rocket: Rocket,
  send: Send,
  server: Server,
  sparkles: Sparkles,
  theater: Theater,
  triangle: Triangle,
  webhook: Webhook,
  zap: Zap,
};

/** The names the icon picker offers when authoring a skill. */
export const ICON_NAMES: readonly string[] = Object.keys(ICONS).sort();

export function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Package;
  return <Icon className={cn('size-4', className)} aria-hidden="true" />;
}
