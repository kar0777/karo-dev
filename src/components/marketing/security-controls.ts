/**
 * The security controls Karo actually implements.
 *
 * Shared by the landing checklist and `/security` so the two can never
 * disagree. Each entry names the mechanism concretely enough to be checked
 * against the code — vague assurances belong in someone else's marketing.
 */

export type SecurityControl = {
  id: string;
  group: SecurityGroup;
  title: string;
  body: string;
};

export type SecurityGroup =
  'isolation' | 'secrets' | 'agent' | 'access' | 'network' | 'platform';

export const SECURITY_GROUP_LABELS: Record<SecurityGroup, string> = {
  isolation: 'Execution isolation',
  secrets: 'Secrets and encryption',
  agent: 'Agent safety',
  access: 'Access control and audit',
  network: 'Network and input',
  platform: 'Platform hardening',
};

export const SECURITY_CONTROLS: readonly SecurityControl[] = [
  {
    id: 'no-host-execution',
    group: 'isolation',
    title: 'The web host never executes user commands',
    body: 'Every command, file read and file write goes through a sandbox provider. There is no code path from a request handler to a shell on the machine serving this page.',
  },
  {
    id: 'rootless',
    group: 'isolation',
    title: 'Rootless, unprivileged sandboxes',
    body: 'Sandboxes run as an unprivileged user with their own PID, mount, network, IPC and user namespaces, a seccomp profile, no CAP_SYS_ADMIN and a read-only base image.',
  },
  {
    id: 'no-socket',
    group: 'isolation',
    title: 'The host Docker socket is never mounted',
    body: 'Container support inside a sandbox is rootless Docker-in-Docker. Nothing you build can reach the daemon that runs Karo, because it is not visible from inside.',
  },
  {
    id: 'lifecycle',
    group: 'isolation',
    title: 'Sandboxes sleep and are destroyed',
    body: 'Idle machines sleep on your plan’s timeout and are destroyed after its retention window. Deleting a project destroys the sandbox and its volume with it.',
  },
  {
    id: 'path-confinement',
    group: 'agent',
    title: 'Path traversal is normalised away',
    body: 'Every path the agent or a client supplies passes through normalizeWorkspacePath() before use. Anything that resolves outside /workspace is rejected, not clamped.',
  },
  {
    id: 'command-policy',
    group: 'agent',
    title: 'Commands are classified before they run',
    body: 'evaluateCommand() returns allow, confirm or deny. Destructive patterns — recursive deletes at root, disk writes, fork bombs, piping a download straight into a shell — are denied outright; borderline commands ask you first.',
  },
  {
    id: 'approval',
    group: 'agent',
    title: 'Edits are reviewed before they apply',
    body: 'In Build mode the agent proposes diffs and nothing is written until you approve them file by file. Auto-approval is a per-project permission you have to turn on deliberately.',
  },
  {
    id: 'permission-matrix',
    group: 'agent',
    title: 'A per-project permission matrix',
    body: 'Reading, writing, deleting, running commands, installing packages, network access, git push, Docker and MCP tool use are separate switches. Agent mode caps them further: Ask may read but neither write nor execute, Plan may run commands to explore but never writes.',
  },
  {
    id: 'prompt-injection',
    group: 'agent',
    title: 'Prompt-injection defence on tool output',
    body: 'Tool results, fetched pages and file contents are untrusted input. They are redacted for known secret values before they reach the model, and instructions found inside them are treated as data, never as commands.',
  },
  {
    id: 'encryption',
    group: 'secrets',
    title: 'AES-256-GCM envelope encryption',
    body: 'API keys, worker tokens, MCP credentials and project environment variables are encrypted at rest with a random 12-byte IV per record and a versioned envelope so the algorithm can be rotated without a destructive migration.',
  },
  {
    id: 'no-plaintext',
    group: 'secrets',
    title: 'Plaintext secrets never reach a client',
    body: 'A stored secret is returned only as a masked preview and its last four characters. Nothing decrypts a secret except the server code that is about to use it.',
  },
  {
    id: 'redaction',
    group: 'secrets',
    title: 'Redaction before logging',
    body: 'redactSecrets() and redactText() strip known key shapes and stored values out of log lines, audit payloads and streamed tool output.',
  },
  {
    id: 'passwords',
    group: 'secrets',
    title: 'scrypt password hashing',
    body: 'Passwords are hashed with scrypt at the OWASP 2024 baseline — N=65536, r=8, p=1, roughly 64 MiB per verification — and compared in constant time.',
  },
  {
    id: 'rbac',
    group: 'access',
    title: 'Role-based access control',
    body: 'Owner, admin, developer and viewer map to an explicit permission table, and every mutating route calls assertCan() before it acts. Platform admin is a separate role that gates /admin entirely.',
  },
  {
    id: 'audit',
    group: 'access',
    title: 'Audit log on every mutation',
    body: 'Who did what, to which resource, from which IP and user agent, with the before and after where it matters. Retention is a plan limit, and the log is exportable as CSV.',
  },
  {
    id: 'sessions',
    group: 'access',
    title: 'Hardened session cookies',
    body: 'Session cookies are httpOnly, SameSite=Lax and Secure in production, scoped to the site, and invalidated server-side on logout rather than only cleared in the browser.',
  },
  {
    id: 'csrf',
    group: 'access',
    title: 'CSRF protection on every mutation',
    body: 'Non-GET route handlers require a CSRF token header issued to the authenticated session. A cross-site form post cannot satisfy it.',
  },
  {
    id: 'ssrf',
    group: 'network',
    title: 'SSRF guard on outbound requests',
    body: 'Every URL Karo fetches on your behalf — MCP endpoints, webhooks, catalogue syncs — is checked against private, loopback, link-local and metadata ranges before the connection is made, and again after any redirect.',
  },
  {
    id: 'egress',
    group: 'network',
    title: 'Sandbox egress is policy-checked',
    body: 'Network access is a per-project agent permission. When it is off, the sandbox cannot reach the internet at all — including package registries.',
  },
  {
    id: 'rate-limits',
    group: 'network',
    title: 'Per-route rate limits',
    body: 'Authentication, chat, execution and billing endpoints each have their own bucket, so a burst against one cannot starve the others.',
  },
  {
    id: 'headers',
    group: 'platform',
    title: 'Strict security headers',
    body: 'A Content Security Policy without unsafe-eval in production, X-Content-Type-Options, X-Frame-Options DENY, a strict referrer policy, a locked-down Permissions-Policy and HSTS with preload.',
  },
  {
    id: 'validation',
    group: 'platform',
    title: 'Schema validation at every boundary',
    body: 'Request bodies, query parameters and worker payloads are parsed with a Zod schema before any of them are used. Invalid input never reaches business logic.',
  },
  {
    id: 'money',
    group: 'platform',
    title: 'Exact money arithmetic',
    body: 'All amounts are integers in micro-USD. There is no floating-point currency anywhere in the billing path, so a rounding error cannot accumulate.',
  },
];

export function controlsInGroup(group: SecurityGroup): SecurityControl[] {
  return SECURITY_CONTROLS.filter((control) => control.group === group);
}

/** The subset the landing page shows — one strong item per group, plus depth. */
export const LANDING_SECURITY_IDS: readonly string[] = [
  'no-host-execution',
  'rootless',
  'no-socket',
  'path-confinement',
  'command-policy',
  'approval',
  'prompt-injection',
  'encryption',
  'redaction',
  'rbac',
  'audit',
  'ssrf',
];
