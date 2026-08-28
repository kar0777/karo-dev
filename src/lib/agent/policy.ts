import type { AgentMode } from '@/lib/db/schema';

/**
 * What the agent itself is allowed to do inside a project — a layer *below*
 * team RBAC. A developer may have `terminal.use`, but this project's agent may
 * still be forbidden from installing packages.
 *
 * Defaults are deliberately conservative: the agent can read and think freely,
 * but writing, executing and reaching the network are opt-in per project.
 */

export type AgentPermissionKey =
  | 'readFiles'
  | 'writeFiles'
  | 'deleteFiles'
  | 'runCommands'
  | 'installPackages'
  | 'networkAccess'
  | 'gitCommit'
  | 'gitPush'
  | 'dockerAccess'
  | 'useMcpTools'
  | 'startServices'
  | 'autoApproveEdits'
  | 'autoApproveCommands';

export type AgentPermissions = Record<AgentPermissionKey, boolean>;

export const AGENT_PERMISSION_META: Record<
  AgentPermissionKey,
  { label: string; description: string; risk: 'low' | 'medium' | 'high' }
> = {
  readFiles: {
    label: 'Read files',
    description: 'Read any file inside the project workspace.',
    risk: 'low',
  },
  writeFiles: {
    label: 'Write files',
    description: 'Create and modify files in the workspace.',
    risk: 'medium',
  },
  deleteFiles: {
    label: 'Delete files',
    description: 'Remove files and directories from the workspace.',
    risk: 'high',
  },
  runCommands: {
    label: 'Run commands',
    description: 'Execute shell commands inside the sandbox.',
    risk: 'medium',
  },
  installPackages: {
    label: 'Install packages',
    description: 'Use npm, pip, apt and similar package managers.',
    risk: 'medium',
  },
  networkAccess: {
    label: 'Network access',
    description: 'Reach the public internet from inside the sandbox.',
    risk: 'medium',
  },
  gitCommit: {
    label: 'Commit to git',
    description: 'Stage and commit changes in the workspace repository.',
    risk: 'low',
  },
  gitPush: {
    label: 'Push to remote',
    description: 'Push commits to the configured git remote.',
    risk: 'high',
  },
  dockerAccess: {
    label: 'Use Docker',
    description: 'Build and run containers via the rootless Docker plugin.',
    risk: 'high',
  },
  useMcpTools: {
    label: 'Use MCP tools',
    description: 'Call tools exposed by connected MCP servers.',
    risk: 'medium',
  },
  startServices: {
    label: 'Start dev servers',
    description: 'Run long-lived processes and expose preview ports.',
    risk: 'low',
  },
  autoApproveEdits: {
    label: 'Auto-approve edits',
    description: 'Apply file changes without asking you to review each diff.',
    risk: 'high',
  },
  autoApproveCommands: {
    label: 'Auto-approve commands',
    description: 'Run non-destructive commands without confirmation.',
    risk: 'high',
  },
};

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  readFiles: true,
  writeFiles: true,
  deleteFiles: false,
  runCommands: true,
  installPackages: true,
  networkAccess: true,
  gitCommit: true,
  gitPush: false,
  dockerAccess: false,
  useMcpTools: true,
  startServices: true,
  autoApproveEdits: false,
  autoApproveCommands: true,
};

/**
 * Mode caps sit on top of the per-project matrix. `Ask` never touches the
 * machine; `Plan` may look but not change; `Build` acts with confirmation;
 * `Auto` acts within whatever the project already permits.
 */
const MODE_CAPS: Record<AgentMode, Partial<AgentPermissions>> = {
  ask: {
    writeFiles: false,
    deleteFiles: false,
    runCommands: false,
    installPackages: false,
    gitCommit: false,
    gitPush: false,
    dockerAccess: false,
    startServices: false,
    autoApproveEdits: false,
    autoApproveCommands: false,
  },
  plan: {
    writeFiles: false,
    deleteFiles: false,
    installPackages: false,
    gitCommit: false,
    gitPush: false,
    autoApproveEdits: false,
    autoApproveCommands: false,
  },
  build: {
    autoApproveEdits: false,
  },
  auto: {},
};

export const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'build', 'auto'];

export const AGENT_MODE_META: Record<
  AgentMode,
  { label: string; short: string; description: string; icon: string }
> = {
  ask: {
    label: 'Ask',
    short: 'Answers only',
    // Reading is deliberately *not* capped in `MODE_CAPS.ask`: a mode that
    // cannot open your files cannot answer a question about them, which is the
    // only thing this mode is for. Say so accurately — this string is what the
    // mode picker, the onboarding permissions step and /docs all show, so an
    // overstatement here becomes a promise the product does not keep.
    description: 'Discuss and explain. The agent reads your code but changes nothing.',
    icon: 'message-circle',
  },
  plan: {
    label: 'Plan',
    short: 'Analyse first',
    description: 'Explore the codebase and produce a plan. No files are modified.',
    icon: 'list-checks',
  },
  build: {
    label: 'Build',
    short: 'Make changes',
    description: 'Write code and run commands. You review diffs before they apply.',
    icon: 'hammer',
  },
  auto: {
    label: 'Auto',
    short: 'Work end to end',
    description:
      'Run the whole task autonomously within the permissions granted to this project.',
    icon: 'zap',
  },
};

export function resolveAgentPermissions(
  project: Partial<AgentPermissions> | null | undefined,
  mode: AgentMode,
): AgentPermissions {
  const merged: AgentPermissions = { ...DEFAULT_AGENT_PERMISSIONS, ...(project ?? {}) };
  const caps = MODE_CAPS[mode];
  for (const [key, capped] of Object.entries(caps) as Array<[AgentPermissionKey, boolean]>) {
    if (capped === false) merged[key] = false;
  }
  return merged;
}

/* ------------------------------------------------------------------ *
 *  Command policy
 * ------------------------------------------------------------------ */

export type CommandVerdict = {
  decision: 'allow' | 'confirm' | 'deny';
  reason: string;
  /** Which rule fired, for the audit log. */
  rule?: string;
};

/**
 * Commands that are never allowed from inside a sandbox — they either attempt
 * to escape it or would brick the machine. Denied regardless of permissions.
 */
const DENY_RULES: Array<{ id: string; pattern: RegExp; reason: string }> = [
  {
    id: 'docker-socket',
    pattern: /\/var\/run\/docker\.sock|-v\s+\/var\/run\/docker\.sock/i,
    reason: 'Mounting the host Docker socket would break sandbox isolation.',
  },
  {
    id: 'privileged-container',
    pattern: /docker\s+(run|create)[^\n]*--privileged/i,
    reason: 'Privileged containers are not permitted inside a Karo sandbox.',
  },
  {
    id: 'host-namespace',
    pattern: /--(pid|net|ipc|userns)=host\b/i,
    reason: 'Sharing host namespaces would break sandbox isolation.',
  },
  {
    id: 'cloud-metadata',
    pattern: /169\.254\.169\.254|metadata\.google\.internal|metadata\.azure\.com/i,
    reason: 'Cloud metadata endpoints are blocked to prevent credential theft.',
  },
  {
    id: 'fork-bomb',
    pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
    reason: 'This is a fork bomb.',
  },
  {
    id: 'root-wipe',
    pattern: /\brm\s+(-[a-zA-Z]*\s+)*-?[rRfF]*\s*\/(?:\s|$|\*)/,
    reason: 'Deleting the filesystem root is not permitted.',
  },
  {
    id: 'raw-device-write',
    pattern: /\b(dd|mkfs\S*)\b[^\n]*\bof=\/dev\/(sd|nvme|xvd|vd)/i,
    reason: 'Writing directly to block devices is not permitted.',
  },
  {
    id: 'escape-workspace',
    pattern: /(^|\s)(cd|pushd)\s+\/(?:etc|proc|sys|boot|root)(\/|\s|$)/,
    reason: 'The agent may not leave the workspace.',
  },
];

/**
 * Commands that are legitimate but destructive enough to require an explicit
 * click, even when `autoApproveCommands` is on.
 */
const CONFIRM_RULES: Array<{ id: string; pattern: RegExp; reason: string }> = [
  {
    id: 'recursive-delete',
    pattern: /\brm\s+(-[a-zA-Z]*\s*)*-?[rR]/,
    reason: 'Recursively deletes files.',
  },
  {
    id: 'git-force-push',
    pattern: /\bgit\s+push\b[^\n]*(--force\b|-f\b)/,
    reason: 'Force-pushes and can overwrite remote history.',
  },
  {
    id: 'git-hard-reset',
    pattern: /\bgit\s+reset\s+--hard\b/,
    reason: 'Discards uncommitted work.',
  },
  {
    id: 'git-clean',
    pattern: /\bgit\s+clean\b[^\n]*-[a-zA-Z]*[fdx]/,
    reason: 'Removes untracked files permanently.',
  },
  {
    id: 'drop-database',
    pattern: /\b(drop\s+(database|table|schema)|truncate\s+table)\b/i,
    reason: 'Destroys database objects.',
  },
  {
    id: 'chmod-777',
    pattern: /\bchmod\s+(-[a-zA-Z]*\s+)*777\b/,
    reason: 'Grants world-writable permissions.',
  },
  {
    id: 'curl-pipe-shell',
    pattern: /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z|k|)sh\b/,
    reason: 'Pipes a downloaded script straight into a shell.',
  },
  {
    id: 'package-publish',
    pattern: /\b(npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b/,
    reason: 'Publishes a package to a public registry.',
  },
  {
    id: 'deploy',
    pattern: /\b(vercel|netlify|fly|wrangler|heroku)\s+(deploy|publish)\b/,
    reason: 'Deploys to a live environment.',
  },
  {
    id: 'kill-all',
    pattern: /\b(pkill|killall)\s+-9\b|\bkill\s+-9\s+-1\b/,
    reason: 'Terminates processes forcefully.',
  },
  {
    id: 'sudo',
    pattern: /(^|\s|&&|\|\||;)sudo\s+/,
    reason: 'Runs with elevated privileges.',
  },
];

const NETWORK_PATTERN = /\b(curl|wget|nc|ncat|ssh|scp|rsync|ftp|telnet)\b|https?:\/\//i;
const INSTALL_PATTERN =
  /\b(npm|pnpm|yarn|bun)\s+(i|add|install)\b|\bpip3?\s+install\b|\bapt(-get)?\s+install\b|\bapk\s+add\b|\bgo\s+(get|install)\b|\bcargo\s+(add|install)\b|\bgem\s+install\b/i;
const DOCKER_PATTERN = /(^|\s)(docker|podman|docker-compose)\b/i;
const GIT_PUSH_PATTERN = /\bgit\s+push\b/i;
const GIT_COMMIT_PATTERN = /\bgit\s+(commit|add)\b/i;

export function evaluateCommand(
  command: string,
  permissions: AgentPermissions,
): CommandVerdict {
  const cmd = command.trim();
  if (!cmd) return { decision: 'deny', reason: 'Empty command.', rule: 'empty' };

  if (!permissions.runCommands) {
    return {
      decision: 'deny',
      reason: 'Running commands is disabled for this project or agent mode.',
      rule: 'permission:runCommands',
    };
  }

  for (const rule of DENY_RULES) {
    if (rule.pattern.test(cmd)) {
      return { decision: 'deny', reason: rule.reason, rule: rule.id };
    }
  }

  if (DOCKER_PATTERN.test(cmd) && !permissions.dockerAccess) {
    return {
      decision: 'deny',
      reason: 'Docker access is not enabled for this project. Install the Docker plugin first.',
      rule: 'permission:dockerAccess',
    };
  }
  if (GIT_PUSH_PATTERN.test(cmd) && !permissions.gitPush) {
    return {
      decision: 'confirm',
      reason: 'Pushing to the git remote requires your approval.',
      rule: 'permission:gitPush',
    };
  }
  if (GIT_COMMIT_PATTERN.test(cmd) && !permissions.gitCommit) {
    return {
      decision: 'deny',
      reason: 'Committing is disabled for this project.',
      rule: 'permission:gitCommit',
    };
  }
  if (INSTALL_PATTERN.test(cmd) && !permissions.installPackages) {
    return {
      decision: 'deny',
      reason: 'Installing packages is disabled for this project.',
      rule: 'permission:installPackages',
    };
  }
  if (NETWORK_PATTERN.test(cmd) && !permissions.networkAccess) {
    return {
      decision: 'deny',
      reason: 'Network access is disabled for this sandbox.',
      rule: 'permission:networkAccess',
    };
  }

  for (const rule of CONFIRM_RULES) {
    if (rule.pattern.test(cmd)) {
      return { decision: 'confirm', reason: rule.reason, rule: rule.id };
    }
  }

  if (!permissions.autoApproveCommands) {
    return {
      decision: 'confirm',
      reason: 'Command approval is required for this project.',
      rule: 'permission:autoApproveCommands',
    };
  }

  return { decision: 'allow', reason: 'Command is within the granted permissions.' };
}

/** Whether a file edit can be applied without a review step. */
export function evaluateFileWrite(
  path: string,
  permissions: AgentPermissions,
  kind: 'created' | 'modified' | 'deleted' | 'renamed',
): CommandVerdict {
  if (kind === 'deleted' && !permissions.deleteFiles) {
    return {
      decision: 'confirm',
      reason: 'Deleting files requires your approval in this project.',
      rule: 'permission:deleteFiles',
    };
  }
  if (!permissions.writeFiles) {
    return {
      decision: 'deny',
      reason: 'Writing files is disabled in this mode.',
      rule: 'permission:writeFiles',
    };
  }
  if (SENSITIVE_FILE_PATTERN.test(path)) {
    return {
      decision: 'confirm',
      reason: 'This file holds configuration or credentials.',
      rule: 'sensitive-file',
    };
  }
  return permissions.autoApproveEdits
    ? { decision: 'allow', reason: 'Auto-approve is on for this project.' }
    : { decision: 'confirm', reason: 'Review the diff before it is applied.' };
}

const SENSITIVE_FILE_PATTERN =
  /(^|\/)(\.env(\..+)?|\.npmrc|\.netrc|id_rsa|id_ed25519|.*\.pem|.*\.key|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;

/* ------------------------------------------------------------------ *
 *  Workspace path safety
 * ------------------------------------------------------------------ */

export const WORKSPACE_ROOT = '/workspace';

/**
 * Normalises a user- or agent-supplied path to a workspace-relative POSIX path,
 * or throws. Rejects traversal, absolute escapes, NUL bytes and Windows drives.
 */
export function normalizeWorkspacePath(input: string): string {
  if (!input || typeof input !== 'string') throw new PathTraversalError(input);
  if (input.includes('\0')) throw new PathTraversalError(input);
  if (/^[a-zA-Z]:[\\/]/.test(input)) throw new PathTraversalError(input);

  let path = input.replace(/\\/g, '/').trim();
  if (path.startsWith(`${WORKSPACE_ROOT}/`)) path = path.slice(WORKSPACE_ROOT.length + 1);
  else if (path === WORKSPACE_ROOT) path = '';

  // An absolute path that is not under the workspace root is an error, not
  // something to reinterpret as relative: silently turning `/etc/passwd` into
  // `etc/passwd` would hand the agent a plausible-looking path it never asked
  // for and hide the escape attempt from the audit log.
  if (path.startsWith('/')) throw new PathTraversalError(input);
  if (path.startsWith('~')) throw new PathTraversalError(input);

  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) throw new PathTraversalError(input);
      parts.pop();
      continue;
    }
    parts.push(segment);
  }

  const result = parts.join('/');
  if (!result) throw new PathTraversalError(input);
  if (result.length > 1024) throw new PathTraversalError(input);
  return result;
}

export function toAbsoluteWorkspacePath(input: string): string {
  return `${WORKSPACE_ROOT}/${normalizeWorkspacePath(input)}`;
}

export function isSafeWorkspacePath(input: string): boolean {
  try {
    normalizeWorkspacePath(input);
    return true;
  } catch {
    return false;
  }
}

export class PathTraversalError extends Error {
  readonly status = 400;
  constructor(readonly attemptedPath: string) {
    super('Path escapes the project workspace and was rejected.');
    this.name = 'PathTraversalError';
  }
}
