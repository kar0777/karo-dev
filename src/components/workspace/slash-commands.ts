import {
  Boxes,
  BrushCleaning,
  CircleDollarSign,
  CirclePlay,
  CircleStop,
  Cog,
  FileDiff,
  FolderTree,
  GitBranch,
  GitCommitVertical,
  Gauge,
  Hammer,
  ListChecks,
  type LucideIcon,
  MessageSquarePlus,
  Monitor,
  Package,
  Plug,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Shrink,
  TestTube,
  Cpu,
  CircleQuestionMark,
} from 'lucide-react';

import type { AgentPermissionKey } from '@/lib/agent/policy';
import type { AgentMode } from '@/lib/db/schema';

import type {
  WorkspaceActivityLevel,
  WorkspaceCustomCommand,
  WorkspaceModel,
  WorkspaceProject,
  WorkspaceSandbox,
  WorkspaceSkill,
  WorkspaceTabKey,
} from './types';

/**
 * The slash-command registry.
 *
 * Everything the composer palette can run lives here as data, so the palette
 * itself only has to worry about search and keyboard handling. Commands that
 * change local state run instantly; the rest go through the same API client the
 * rest of the workspace uses, so failures surface as normal error toasts.
 */

export type SlashCommandCategory =
  'Session' | 'Agent' | 'Project' | 'Sandbox' | 'Extensions' | 'Account';

export type SlashCommandDialog = 'help' | 'context' | 'model' | 'mode';

export type SlashCommandContext = {
  /** Everything typed after the command name, trimmed. */
  args: string;
  project: WorkspaceProject;
  mode: AgentMode;
  models: readonly WorkspaceModel[];
  activeModelId: string | null;
  sandbox: WorkspaceSandbox | null;
  skills: readonly WorkspaceSkill[];
  permissions: Record<AgentPermissionKey, boolean>;
  isStreaming: boolean;

  setMode: (mode: AgentMode) => void;
  setModel: (modelId: string) => void;
  setTab: (tab: WorkspaceTabKey) => void;
  openDialog: (dialog: SlashCommandDialog) => void;
  newConversation: () => void;
  clearConversation: () => void;
  compactConversation: () => void;
  stopRun: () => void;
  retryLast: () => void;
  /** Sends `text` to the agent as a normal user message. */
  sendPrompt: (text: string) => void;
  /** Switches to the Terminal tab and types the command into the active shell. */
  runInTerminal: (command: string) => void;
  startSandbox: () => void;
  restartSandbox: () => void;
  focusFileSearch: () => void;
  navigate: (href: string) => void;
  notify: (level: WorkspaceActivityLevel, message: string, detail?: string) => void;
};

export type SlashCommand = {
  name: string;
  description: string;
  category: SlashCommandCategory;
  icon: LucideIcon;
  /** Keyboard hint shown on the right of the palette row. */
  shortcut?: string;
  /** Free-form argument hint, e.g. `/model sonnet`. */
  argHint?: string;
  run: (ctx: SlashCommandContext) => void;
};

function matchModel(
  models: readonly WorkspaceModel[],
  query: string,
): WorkspaceModel | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    models.find((m) => m.slug.toLowerCase() === needle) ??
    models.find((m) => m.displayName.toLowerCase() === needle) ??
    models.find((m) => m.slug.toLowerCase().includes(needle)) ??
    models.find((m) => m.displayName.toLowerCase().includes(needle))
  );
}

const MODE_ALIASES: Record<string, AgentMode> = {
  ask: 'ask',
  plan: 'plan',
  build: 'build',
  auto: 'auto',
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  /* ---------------- Session ---------------- */
  {
    name: 'help',
    description: 'List every slash command and what it does',
    category: 'Session',
    icon: CircleQuestionMark,
    shortcut: '?',
    run: (ctx) => ctx.openDialog('help'),
  },
  {
    name: 'new',
    description: 'Start a fresh conversation in this project',
    category: 'Session',
    icon: MessageSquarePlus,
    shortcut: 'Ctrl+Shift+N',
    run: (ctx) => ctx.newConversation(),
  },
  {
    name: 'clear',
    description: 'Archive this conversation and begin an empty one',
    category: 'Session',
    icon: BrushCleaning,
    run: (ctx) => ctx.clearConversation(),
  },
  {
    name: 'compact',
    description: 'Summarise the history to free up context window',
    category: 'Session',
    icon: Shrink,
    run: (ctx) => ctx.compactConversation(),
  },
  {
    name: 'context',
    description: 'Show how much of the context window this chat uses',
    category: 'Session',
    icon: Gauge,
    run: (ctx) => ctx.openDialog('context'),
  },

  /* ---------------- Agent ---------------- */
  {
    name: 'model',
    description: 'Switch the model for this conversation',
    category: 'Agent',
    icon: Cpu,
    argHint: '[name]',
    run: (ctx) => {
      const model = matchModel(ctx.models, ctx.args);
      if (model) {
        ctx.setModel(model.id);
        ctx.notify('success', `Model set to ${model.displayName}.`);
        return;
      }
      if (ctx.args) {
        ctx.notify(
          'warning',
          `No model matches “${ctx.args}”.`,
          'Pick one from the list instead.',
        );
      }
      ctx.openDialog('model');
    },
  },
  {
    name: 'mode',
    description: 'Change the agent mode: ask, plan, build or auto',
    category: 'Agent',
    icon: ListChecks,
    argHint: '[ask|plan|build|auto]',
    run: (ctx) => {
      const wanted = MODE_ALIASES[ctx.args.trim().toLowerCase()];
      if (wanted) {
        ctx.setMode(wanted);
        ctx.notify('success', `Agent mode set to ${wanted}.`);
        return;
      }
      ctx.openDialog('mode');
    },
  },
  {
    name: 'plan',
    description: 'Switch to Plan mode — analyse without changing files',
    category: 'Agent',
    icon: ListChecks,
    run: (ctx) => {
      ctx.setMode('plan');
      ctx.notify('info', 'Plan mode. The agent will explore and propose, not edit.');
    },
  },
  {
    name: 'build',
    description: 'Switch to Build mode — write code and run commands',
    category: 'Agent',
    icon: Hammer,
    run: (ctx) => {
      ctx.setMode('build');
      ctx.notify('info', 'Build mode. You review diffs before they apply.');
    },
  },
  {
    name: 'stop',
    description: 'Cancel the run that is currently streaming',
    category: 'Agent',
    icon: CircleStop,
    shortcut: 'Esc',
    run: (ctx) => {
      if (!ctx.isStreaming) {
        ctx.notify('info', 'Nothing is running right now.');
        return;
      }
      ctx.stopRun();
    },
  },
  {
    name: 'retry',
    description: 'Run the last request again with the current model',
    category: 'Agent',
    icon: RotateCcw,
    run: (ctx) => ctx.retryLast(),
  },

  /* ---------------- Project ---------------- */
  {
    name: 'files',
    description: 'Focus the file explorer and search file contents',
    category: 'Project',
    icon: FolderTree,
    shortcut: 'Ctrl+P',
    run: (ctx) => ctx.focusFileSearch(),
  },
  {
    name: 'diff',
    description: 'Review every pending file change',
    category: 'Project',
    icon: FileDiff,
    run: (ctx) => ctx.setTab('changes'),
  },
  {
    name: 'git',
    description: 'Show the working tree status in the terminal',
    category: 'Project',
    icon: GitBranch,
    run: (ctx) => ctx.runInTerminal('git status --short --branch'),
  },
  {
    name: 'commit',
    description: 'Ask the agent to commit the current changes',
    category: 'Project',
    icon: GitCommitVertical,
    argHint: '[message]',
    run: (ctx) => {
      if (!ctx.permissions.gitCommit) {
        ctx.notify(
          'warning',
          'Committing is disabled for this project.',
          'Enable “Commit to git” in the agent permissions to allow it.',
        );
        return;
      }
      const message = ctx.args.trim();
      ctx.sendPrompt(
        message
          ? `Stage every pending change and commit it with the message: "${message}".`
          : 'Stage every pending change and commit it with a concise conventional-commit message that describes what changed.',
      );
    },
  },
  {
    name: 'test',
    description: 'Run the project test suite in the terminal',
    category: 'Project',
    icon: TestTube,
    run: (ctx) => ctx.runInTerminal('npm test'),
  },
  {
    name: 'lint',
    description: 'Run the linter in the terminal',
    category: 'Project',
    icon: ShieldCheck,
    run: (ctx) => ctx.runInTerminal('npm run lint'),
  },
  {
    name: 'build-project',
    description: 'Run the production build in the terminal',
    category: 'Project',
    icon: Package,
    run: (ctx) => ctx.runInTerminal('npm run build'),
  },
  {
    name: 'preview',
    description: 'Open the live preview of the dev server',
    category: 'Project',
    icon: Monitor,
    run: (ctx) => ctx.setTab('preview'),
  },
  {
    name: 'terminal',
    description: 'Jump to the terminal',
    category: 'Project',
    icon: SquareTerminal,
    shortcut: 'Ctrl+`',
    run: (ctx) => ctx.setTab('terminal'),
  },

  /* ---------------- Sandbox ---------------- */
  {
    name: 'sandbox',
    description: 'Start the sandbox, or show why it is not running',
    category: 'Sandbox',
    icon: Server,
    run: (ctx) => {
      if (!ctx.sandbox) {
        ctx.notify(
          'warning',
          'This project has no sandbox yet.',
          'Create one from the machine card in the right-hand panel.',
        );
        return;
      }
      if (ctx.sandbox.status === 'running') {
        ctx.notify(
          'info',
          `${ctx.sandbox.name} is running on ${ctx.sandbox.provider}.`,
          `${ctx.sandbox.cpuCores} vCPU · ${ctx.sandbox.memoryMb} MB RAM · ${ctx.sandbox.diskGb} GB disk`,
        );
        return;
      }
      ctx.startSandbox();
    },
  },
  {
    name: 'restart',
    description: 'Restart the sandbox and clear its running processes',
    category: 'Sandbox',
    icon: RefreshCw,
    run: (ctx) => ctx.restartSandbox(),
  },
  {
    name: 'docker',
    description: 'List containers running inside the sandbox',
    category: 'Sandbox',
    icon: Boxes,
    run: (ctx) => {
      if (!ctx.permissions.dockerAccess) {
        ctx.notify(
          'warning',
          'Docker is not enabled for this project.',
          'Install the Docker plugin and grant the Docker permission first.',
        );
        return;
      }
      ctx.runInTerminal('docker ps --all');
    },
  },

  /* ---------------- Extensions ---------------- */
  {
    name: 'mcp',
    description: 'Manage MCP servers and their tools',
    category: 'Extensions',
    icon: Plug,
    run: (ctx) => ctx.navigate('/app/mcp'),
  },
  {
    name: 'skills',
    description: 'Browse and install agent skills',
    category: 'Extensions',
    icon: Sparkles,
    run: (ctx) => ctx.navigate('/app/skills'),
  },
  {
    name: 'plugins',
    description: 'Browse and configure plugins',
    category: 'Extensions',
    icon: Package,
    run: (ctx) => ctx.navigate('/app/plugins'),
  },

  /* ---------------- Account ---------------- */
  {
    name: 'usage',
    description: 'Open usage and cost analytics',
    category: 'Account',
    icon: Gauge,
    run: (ctx) => ctx.navigate('/app/usage'),
  },
  {
    name: 'billing',
    description: 'Open billing, balance and plan',
    category: 'Account',
    icon: CircleDollarSign,
    run: (ctx) => ctx.navigate('/app/billing'),
  },
  {
    name: 'settings',
    description: 'Open workspace settings',
    category: 'Account',
    icon: Cog,
    run: (ctx) => ctx.navigate('/app/settings'),
  },
];

export const SLASH_CATEGORY_ORDER: readonly SlashCommandCategory[] = [
  'Session',
  'Agent',
  'Project',
  'Sandbox',
  'Extensions',
  'Account',
];

/**
 * Merges the built-in registry with the commands contributed by installed
 * skills and plugins. A contributed command is just a stored prompt, so it
 * runs by sending that prompt (plus whatever the user typed) to the agent.
 */
export function buildSlashCommands(
  custom: readonly WorkspaceCustomCommand[],
  skills: readonly WorkspaceSkill[],
): SlashCommand[] {
  const builtinNames = new Set(SLASH_COMMANDS.map((command) => command.name));
  const extra: SlashCommand[] = [];
  const seen = new Set<string>();

  const add = (
    name: string,
    description: string,
    prompt: string,
    label: string,
    icon: LucideIcon,
  ) => {
    const key = name.replace(/^\//, '').trim();
    if (!key || builtinNames.has(key) || seen.has(key)) return;
    seen.add(key);
    extra.push({
      name: key,
      description: description || `Run the ${label} command`,
      category: 'Extensions',
      icon,
      argHint: '[details]',
      run: (ctx) => {
        const body = ctx.args ? `${prompt}\n\n${ctx.args}` : prompt;
        ctx.sendPrompt(body);
      },
    });
  };

  for (const command of custom) {
    if (!command.prompt) continue;
    add(
      command.name,
      command.description,
      command.prompt,
      command.sourceRef ?? command.source,
      command.source === 'plugin' ? Package : Sparkles,
    );
  }

  for (const skill of skills) {
    if (!skill.isEnabled) continue;
    for (const command of skill.commands) {
      if (!command.prompt) continue;
      add(command.name, command.description, command.prompt, skill.name, CirclePlay);
    }
  }

  return [...SLASH_COMMANDS, ...extra];
}
