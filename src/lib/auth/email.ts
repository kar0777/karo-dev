import type { Transporter } from 'nodemailer';

import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

/**
 * Outbound email.
 *
 * Karo must run with zero external services, so the default transport writes a
 * clearly-delimited block to the server console *including the full action
 * URL*. Local sign-up, verification and password reset therefore work with no
 * mail server, no API key and no tunnel — you copy the link out of the terminal.
 *
 * `EMAIL_TRANSPORT=smtp` switches to real delivery over `SMTP_URL`. That path is
 * the one production runs on: verification and password-reset links are the only
 * way a customer who is not the operator can finish signing up, so a console
 * transport in production means a broken product, not a degraded one. `env.ts`
 * therefore refuses to boot a production process that asks for `smtp` without a
 * `SMTP_URL`, and this module throws rather than quietly writing a customer's
 * reset link into a log file.
 */

const log = createLogger('email');

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

export type EmailTemplate = Pick<EmailMessage, 'subject' | 'text' | 'html'>;

export type SendEmailResult = {
  delivered: boolean;
  transport: 'console' | 'smtp';
  /** Message id reported by the relay. Absent on the console transport. */
  messageId?: string;
};

const RULE = '─'.repeat(72);

function consoleTransport(message: EmailMessage): void {
  const urls = extractUrls(message.text);
  const lines = [
    '',
    RULE,
    `  ✉  ${env.APP_NAME} — outgoing email (console transport)`,
    RULE,
    `  To:      ${message.to}`,
    `  From:    ${env.EMAIL_FROM}`,
    `  Subject: ${message.subject}`,
  ];

  if (urls.length > 0) {
    lines.push('', '  Action links:');
    for (const url of urls) lines.push(`    → ${url}`);
  }

  lines.push(
    '',
    ...message.text
      .trim()
      .split('\n')
      .map((line) => `  ${line}`),
    RULE,
    '',
  );

  // Written directly rather than through the logger: this is a development
  // affordance meant to be read by a human, not an indexed log record.

  console.info(lines.join('\n'));
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/g);
  return matches ? Array.from(new Set(matches)) : [];
}

/* ------------------------------------------------------------------ *
 *  SMTP transport
 * ------------------------------------------------------------------ */

/**
 * Built once and reused. `pool: true` keeps a small number of authenticated
 * connections open, which matters because the alternative is a TLS handshake
 * plus an AUTH round trip on every verification email — latency a user waits
 * through during sign-up.
 *
 * Cached against the URL it was built from so a changed `SMTP_URL` in a
 * long-lived dev process rebuilds the transport instead of silently sending
 * through the old relay.
 */
let smtpTransport: { url: string; transporter: Transporter } | null = null;

/** Nothing here may hang a request: an unreachable relay must fail, not stall. */
const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailConfigurationError';
  }
}

async function getSmtpTransport(): Promise<Transporter> {
  const url = env.SMTP_URL?.trim();
  if (!url) {
    throw new EmailConfigurationError(
      'EMAIL_TRANSPORT=smtp requires SMTP_URL (for example smtps://user:pass@smtp.example.com:465).',
    );
  }

  if (smtpTransport?.url === url) return smtpTransport.transporter;

  // Imported lazily so the console transport — the default, and the only one a
  // demo install uses — never pulls the mail library into the module graph.
  const nodemailer = await import('nodemailer');

  const transporter = nodemailer.createTransport({
    url,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    ...SMTP_TIMEOUTS,
  });

  smtpTransport = { url, transporter };
  return transporter;
}

/**
 * Throws on failure rather than falling back to the console.
 *
 * Falling back would write a single-use password-reset link into the server log
 * — a credential, in plain text, in the one place that gets shipped to log
 * aggregators and shared in support threads. The callers that must not fail
 * because of mail (`register`, `requestPasswordReset`) already catch and log;
 * the ones that surface the error (resend verification, team invites) are the
 * ones where the user genuinely needs to be told the mail did not go out.
 */
async function sendViaSmtp(message: EmailMessage): Promise<SendEmailResult> {
  const transporter = await getSmtpTransport();

  const info = await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
  });

  // `to` is logged because operators need to correlate a delivery complaint with
  // a send; the body and the action URL inside it are never logged.
  log.info('Email delivered over SMTP', {
    to: message.to,
    subject: message.subject,
    messageId: info.messageId,
    accepted: info.accepted?.length ?? 0,
    rejected: info.rejected?.length ?? 0,
  });

  if (info.rejected && info.rejected.length > 0) {
    log.warn('The relay rejected some recipients', {
      subject: message.subject,
      rejected: info.rejected.length,
    });
  }

  return { delivered: true, transport: 'smtp', messageId: info.messageId };
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  if (env.EMAIL_TRANSPORT === 'smtp') return sendViaSmtp(message);

  consoleTransport(message);
  log.debug('Email written to the console transport', {
    to: message.to,
    subject: message.subject,
  });
  return { delivered: true, transport: 'console' };
}

export type EmailTransportStatus = {
  transport: 'console' | 'smtp';
  /** `false` only when the transport is configured but unusable right now. */
  ok: boolean;
  /** Present when `ok` is false. Never contains the relay host or credentials. */
  reason?: string;
};

/**
 * Probed at most this often. `/api/health` is what the container healthcheck and
 * the load balancer call every ~30s, and `verify()` is a real connection plus an
 * AUTH exchange — doing that per probe is a good way to get a sending domain
 * throttled by its own relay for looking like a credential-stuffing client.
 */
const SMTP_VERIFY_TTL_MS = 5 * 60_000;

let smtpVerdict: { at: number; status: EmailTransportStatus } | null = null;

/**
 * Probes the transport without sending anything, for `/api/health`.
 *
 * The console transport is always reachable, so this is a real check only under
 * `EMAIL_TRANSPORT=smtp`. The failure reason is deliberately coarse: the health
 * endpoint is unauthenticated, and an SMTP error string routinely carries the
 * relay hostname and sometimes the rejected username.
 */
export async function checkEmailTransport(): Promise<EmailTransportStatus> {
  if (env.EMAIL_TRANSPORT !== 'smtp') return { transport: 'console', ok: true };

  if (smtpVerdict && Date.now() - smtpVerdict.at < SMTP_VERIFY_TTL_MS) {
    return smtpVerdict.status;
  }

  let status: EmailTransportStatus;
  try {
    const transporter = await getSmtpTransport();
    await transporter.verify();
    status = { transport: 'smtp', ok: true };
  } catch (error) {
    log.error('SMTP transport verification failed', { error });
    status = {
      transport: 'smtp',
      ok: false,
      reason: error instanceof EmailConfigurationError ? 'not configured' : 'relay unreachable',
    };
  }

  smtpVerdict = { at: Date.now(), status };
  return status;
}

/** Closes pooled SMTP connections. Tests and graceful shutdown. */
export function closeEmailTransport(): void {
  smtpTransport?.transporter.close();
  smtpTransport = null;
  smtpVerdict = null;
}

/* ------------------------------------------------------------------ *
 *  Templates
 *
 *  Email clients do not understand `oklch()`, CSS variables or `@media
 *  prefers-color-scheme` reliably, so the palette below is a hex
 *  approximation of Karo's light theme, applied inline.
 * ------------------------------------------------------------------ */

const PALETTE = {
  bg: '#f7f6f3',
  surface: '#ffffff',
  border: '#e5e2dc',
  fg: '#2b2926',
  muted: '#6b665f',
  subtle: '#8d877f',
  primary: '#0f7c69',
  primaryFg: '#ffffff',
} as const;

type LayoutOptions = {
  preheader: string;
  heading: string;
  body: string[];
  cta?: { label: string; url: string };
  footnote?: string[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Single-column, table-free, inline-styled — the shape clients agree on. */
function layout(options: LayoutOptions): string {
  const paragraphs = options.body
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${PALETTE.fg};">${p}</p>`,
    )
    .join('');

  const cta = options.cta
    ? `<div style="margin:24px 0 20px;">
         <a href="${escapeHtml(options.cta.url)}"
            style="display:inline-block;padding:11px 20px;border-radius:8px;background:${PALETTE.primary};color:${PALETTE.primaryFg};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(options.cta.label)}</a>
       </div>
       <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${PALETTE.muted};">
         If the button does not work, paste this link into your browser:
       </p>
       <p style="margin:0 0 4px;font-size:12px;line-height:1.6;word-break:break-all;">
         <a href="${escapeHtml(options.cta.url)}" style="color:${PALETTE.primary};">${escapeHtml(options.cta.url)}</a>
       </p>`
    : '';

  const footnotes = (options.footnote ?? [])
    .map(
      (line) =>
        `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${PALETTE.subtle};">${line}</p>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PALETTE.bg};font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader)}</div>
  <div style="padding:32px 16px;">
    <div style="max-width:560px;margin:0 auto;background:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:12px;overflow:hidden;">
      <div style="padding:20px 28px;border-bottom:1px solid ${PALETTE.border};">
        <span style="display:inline-block;width:12px;height:12px;background:${PALETTE.primary};transform:rotate(45deg);border-radius:2px;vertical-align:middle;"></span>
        <span style="margin-left:10px;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:${PALETTE.fg};vertical-align:middle;">${escapeHtml(env.APP_NAME)}</span>
      </div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;font-weight:600;letter-spacing:-0.015em;color:${PALETTE.fg};">${escapeHtml(options.heading)}</h1>
        ${paragraphs}
        ${cta}
      </div>
      <div style="padding:16px 28px;border-top:1px solid ${PALETTE.border};background:${PALETTE.bg};">
        ${footnotes}
        <p style="margin:0;font-size:12px;line-height:1.6;color:${PALETTE.subtle};">
          ${escapeHtml(env.APP_NAME)} — a cloud workspace where your AI agent has a real computer.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export type EmailRecipient = {
  email: string;
  name?: string | null;
};

function greetingName(user: EmailRecipient): string {
  const name = user.name?.trim();
  if (name) return name.split(/\s+/)[0] ?? name;
  return user.email.split('@')[0] ?? 'there';
}

export function verificationEmail(user: EmailRecipient, url: string): EmailTemplate {
  const name = greetingName(user);
  const subject = `Confirm your email for ${env.APP_NAME}`;

  const text = [
    `Hi ${name},`,
    '',
    `Confirm this address to finish setting up your ${env.APP_NAME} account. The link is valid for 24 hours and can be used once.`,
    '',
    url,
    '',
    'If you did not create a Karo account, ignore this email — nothing was set up and the address will not be used again.',
  ].join('\n');

  const html = layout({
    preheader: 'One click to confirm your email address.',
    heading: `Confirm your email, ${escapeHtml(name)}`,
    body: [
      `Confirming this address finishes setting up your ${escapeHtml(env.APP_NAME)} account and lets us send you quota and billing alerts before they bite.`,
      'The link is valid for <strong>24 hours</strong> and can be used once.',
    ],
    cta: { label: 'Confirm email address', url },
    footnote: ['If you did not create a Karo account, ignore this email — nothing was set up.'],
  });

  return { subject, text, html };
}

export function passwordResetEmail(user: EmailRecipient, url: string): EmailTemplate {
  const name = greetingName(user);
  const subject = `Reset your ${env.APP_NAME} password`;

  const text = [
    `Hi ${name},`,
    '',
    `Someone asked to reset the password for the ${env.APP_NAME} account on ${user.email}. If that was you, use the link below. It expires in 1 hour and can be used once.`,
    '',
    url,
    '',
    'Setting a new password signs you out of every device.',
    '',
    'If this was not you, no action is needed — your current password still works. Consider changing it if you did not expect this email.',
  ].join('\n');

  const html = layout({
    preheader: 'Reset your password — this link expires in one hour.',
    heading: 'Reset your password',
    body: [
      `Someone asked to reset the password for the ${escapeHtml(env.APP_NAME)} account on <strong>${escapeHtml(user.email)}</strong>.`,
      'The link is valid for <strong>1 hour</strong> and can be used once. Setting a new password signs you out of every device.',
    ],
    cta: { label: 'Choose a new password', url },
    footnote: ['If this was not you, no action is needed — your current password still works.'],
  });

  return { subject, text, html };
}

export type TeamInviteDetails = {
  teamName: string;
  roleLabel: string;
  inviterName: string;
  url: string;
  expiresInDays?: number;
};

export function teamInviteEmail(
  recipient: EmailRecipient,
  invite: TeamInviteDetails,
): EmailTemplate {
  const expiresInDays = invite.expiresInDays ?? 7;
  const subject = `${invite.inviterName} invited you to ${invite.teamName} on ${env.APP_NAME}`;

  const text = [
    `${invite.inviterName} invited you to join the team "${invite.teamName}" on ${env.APP_NAME} as ${invite.roleLabel}.`,
    '',
    `${env.APP_NAME} gives your AI coding agent a real sandboxed machine: it edits the project's files, runs commands in a terminal and connects tools, while every token and compute-second is metered against the team's plan.`,
    '',
    'Accept the invitation:',
    invite.url,
    '',
    `The invitation expires in ${expiresInDays} days.`,
    '',
    'If you were not expecting this, you can ignore the email — nothing is shared with you until you accept.',
  ].join('\n');

  const html = layout({
    preheader: `${invite.inviterName} invited you to ${invite.teamName}.`,
    heading: `Join ${escapeHtml(invite.teamName)} on ${escapeHtml(env.APP_NAME)}`,
    body: [
      `<strong>${escapeHtml(invite.inviterName)}</strong> invited you to join <strong>${escapeHtml(invite.teamName)}</strong> as <strong>${escapeHtml(invite.roleLabel)}</strong>.`,
      `${escapeHtml(env.APP_NAME)} gives your AI coding agent a real sandboxed machine — it edits project files, runs shell commands and connects tools, with every token and compute-second metered against the team's plan.`,
      `This invitation expires in <strong>${expiresInDays} days</strong>.`,
    ],
    cta: { label: 'Accept invitation', url: invite.url },
    footnote: [
      'If you were not expecting this, ignore the email — nothing is shared with you until you accept.',
    ],
  });

  return { subject, text, html };
}

/** Convenience: build a template and send it in one call. */
export async function sendTemplate(
  to: string,
  template: EmailTemplate,
): Promise<SendEmailResult> {
  return sendEmail({ to, ...template });
}
