import { ZodError, type ZodIssue } from 'zod';

import { PathTraversalError } from '@/lib/agent/policy';
import { PermissionError } from '@/lib/rbac/permissions';
import { SANDBOX_ERROR_COPY, SandboxError } from '@/lib/sandbox/types';

/**
 * One error taxonomy for the whole product.
 *
 * Every error carries a **user-facing `title` and `description`** so the client
 * can render it directly — no second lookup table, no `switch (status)` in a
 * component. The rule the copy follows: say what happened *and* what to do
 * next. "Something went wrong" is not an acceptable description.
 */

export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'csrf_failed'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'payment_required'
  | 'provider_unavailable'
  | 'maintenance'
  | 'timeout'
  | 'internal_error';

export type ApiErrorInit = {
  status: number;
  code: ApiErrorCode;
  message: string;
  title: string;
  description: string;
  details?: unknown;
  retryAfterSeconds?: number;
  /** False for 5xx: the raw message is logged, never shown. */
  expose?: boolean;
  cause?: unknown;
};

export type ApiErrorBody = {
  code: ApiErrorCode;
  title: string;
  message: string;
  details?: unknown;
  retryAfterSeconds?: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly title: string;
  readonly description: string;
  readonly details?: unknown;
  readonly retryAfterSeconds?: number;
  readonly expose: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.description = init.description;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.expose = init.expose ?? init.status < 500;
  }

  /** The wire shape. `production` hides the raw message of non-exposed errors. */
  toBody(includeInternalMessage: boolean): ApiErrorBody {
    const body: ApiErrorBody = {
      code: this.code,
      title: this.title,
      message: this.expose || includeInternalMessage ? this.message : this.description,
    };
    if (this.details !== undefined) body.details = this.details;
    if (this.retryAfterSeconds !== undefined) body.retryAfterSeconds = this.retryAfterSeconds;
    return body;
  }
}

/* ------------------------------------------------------------------ *
 *  Concrete classes
 * ------------------------------------------------------------------ */

export type ValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export class ValidationError extends ApiError {
  readonly issues: ValidationIssue[];

  constructor(
    message = 'The request could not be validated.',
    issues: ValidationIssue[] = [],
    options: { title?: string; description?: string } = {},
  ) {
    super({
      status: 400,
      code: 'validation_error',
      message,
      title: options.title ?? 'Check the highlighted fields',
      description:
        options.description ??
        'Some values were missing or in the wrong format. Fix them and try again.',
      details: issues.length > 0 ? issues : undefined,
    });
    this.issues = issues;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication is required.') {
    super({
      status: 401,
      code: 'unauthorized',
      message,
      title: 'Sign in to continue',
      description: 'Your session has expired or you are not signed in. Sign in and retry.',
    });
  }
}

export class ForbiddenError extends ApiError {
  constructor(
    message = 'You do not have permission to do that.',
    options: {
      code?: ApiErrorCode;
      title?: string;
      description?: string;
      details?: unknown;
    } = {},
  ) {
    super({
      status: 403,
      code: options.code ?? 'forbidden',
      message,
      title: options.title ?? 'Permission denied',
      description:
        options.description ??
        'Your role in this team does not allow this action. Ask an owner or admin to do it, or to change your role.',
      details: options.details,
    });
  }
}

/**
 * The `auth.requireEmailVerification` gate. Its own class rather than a bare
 * `ForbiddenError` because the remedy is nothing like a permission problem: no
 * admin can grant this, the fix is a link already sitting in the user's inbox,
 * and the copy has to point at it.
 */
export class EmailUnverifiedError extends ForbiddenError {
  constructor(message = 'Confirm your email address before changing anything.') {
    super(message, {
      title: 'Confirm your email first',
      description:
        'This Karo install requires a confirmed email address. Open the link we sent you, or request a new one from the confirmation page — your own settings stay available meanwhile.',
    });
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found.', options: { title?: string; description?: string } = {}) {
    super({
      status: 404,
      code: 'not_found',
      message,
      title: options.title ?? 'Not found',
      description:
        options.description ??
        'This item does not exist, or it belongs to a team you are not a member of.',
    });
  }
}

export class ConflictError extends ApiError {
  constructor(
    message = 'That conflicts with something that already exists.',
    options: { title?: string; description?: string; details?: unknown } = {},
  ) {
    super({
      status: 409,
      code: 'conflict',
      message,
      title: options.title ?? 'Already exists',
      description:
        options.description ??
        'Something with that name or identifier already exists. Pick another.',
      details: options.details,
    });
  }
}

export class RateLimitError extends ApiError {
  constructor(retryAfterSeconds: number, message = 'Too many requests.') {
    super({
      status: 429,
      code: 'rate_limited',
      message,
      title: 'Slow down for a moment',
      description: `You have made too many requests. Try again in ${formatSeconds(retryAfterSeconds)}.`,
      retryAfterSeconds,
    });
  }
}

export class QuotaExceededError extends ApiError {
  constructor(
    message = 'Your plan quota for this billing period is used up.',
    options: { details?: unknown } = {},
  ) {
    super({
      status: 402,
      code: 'quota_exceeded',
      message,
      title: 'Plan quota reached',
      description:
        'This billing period is fully used. Top up your balance or upgrade the plan to keep going — your work is saved.',
      details: options.details,
    });
  }
}

export class PaymentRequiredError extends ApiError {
  constructor(
    message = 'A payment is required to continue.',
    options: { details?: unknown } = {},
  ) {
    super({
      status: 402,
      code: 'payment_required',
      message,
      title: 'Balance too low',
      description:
        'Your pay-as-you-go balance cannot cover this run. Add credit in Billing and try again.',
      details: options.details,
    });
  }
}

export class ProviderUnavailableError extends ApiError {
  constructor(
    message = 'An upstream provider is unavailable.',
    options: { title?: string; description?: string; retryAfterSeconds?: number } = {},
  ) {
    super({
      status: 503,
      code: 'provider_unavailable',
      message,
      title: options.title ?? 'Provider unavailable',
      description:
        options.description ??
        'Karo could not reach the upstream provider. Nothing was charged; try again in a moment.',
      retryAfterSeconds: options.retryAfterSeconds,
      expose: true,
    });
  }
}

/**
 * The `platform.maintenanceMode` gate. 503 rather than 403 because nothing is
 * wrong with the caller or with their permissions — the platform is choosing
 * not to take changes for a while, which is what 503 already means to a person
 * and to a proxy. No `retryAfterSeconds`: an operator flips this by hand, so any
 * number here would be a guess wearing the clothes of a promise.
 */
export class MaintenanceModeError extends ApiError {
  constructor(message = 'Karo is in maintenance mode and is not accepting changes.') {
    super({
      status: 503,
      code: 'maintenance',
      message,
      title: 'Maintenance in progress',
      description:
        'A platform administrator paused changes while work is under way. Everything you can already see stays readable and nothing you saved is affected — try again in a few minutes.',
      expose: true,
    });
  }
}

export class TimeoutError extends ApiError {
  constructor(message = 'The operation timed out.') {
    super({
      status: 504,
      code: 'timeout',
      message,
      title: 'Timed out',
      description:
        'The operation took too long and was stopped. Try again, or narrow the request.',
      expose: true,
    });
  }
}

export class InternalError extends ApiError {
  constructor(message = 'Unexpected server error.', cause?: unknown) {
    super({
      status: 500,
      code: 'internal_error',
      message,
      title: 'Something broke on our side',
      description:
        'This is a bug in Karo, not in your project. The failure has been logged — retry, and contact support if it persists.',
      expose: false,
      cause,
    });
  }
}

/* ------------------------------------------------------------------ *
 *  Mapping
 * ------------------------------------------------------------------ */

function formatSeconds(seconds: number): string {
  if (seconds <= 1) return 'a second';
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

export function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue: ZodIssue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

function sandboxToApiError(error: SandboxError): ApiError {
  const copy = SANDBOX_ERROR_COPY[error.code];
  switch (error.code) {
    case 'provider_unavailable':
    case 'worker_offline':
      return new ProviderUnavailableError(error.message, {
        title: copy.title,
        description: copy.description,
      });
    case 'not_found':
      return new NotFoundError(error.message, {
        title: copy.title,
        description: copy.description,
      });
    case 'not_running':
      return new ConflictError(error.message, {
        title: copy.title,
        description: copy.description,
      });
    case 'quota_exceeded':
      return new QuotaExceededError(error.message);
    case 'timeout':
      return new TimeoutError(error.message);
    case 'command_denied':
    case 'path_denied':
      return new ForbiddenError(error.message, {
        title: copy.title,
        description: copy.description,
      });
    case 'internal':
    default:
      return new InternalError(error.message, error);
  }
}

/**
 * Next.js implements `redirect()` and `notFound()` by throwing a tagged error.
 * Swallowing those inside a catch-all would turn a redirect into a 500, so
 * callers must re-throw anything this returns true for.
 */
export function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== 'string') return false;
  return (
    digest === 'NEXT_NOT_FOUND' ||
    digest === 'NEXT_REDIRECT' ||
    digest.startsWith('NEXT_REDIRECT;') ||
    digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')
  );
}

/** Normalises anything thrown anywhere in the stack into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    return new ValidationError('The request body failed validation.', zodIssues(error));
  }

  if (error instanceof PermissionError) {
    return new ForbiddenError(error.message, {
      details: { permission: error.permission, role: error.role },
    });
  }

  if (error instanceof PathTraversalError) {
    return new ValidationError(
      error.message,
      [{ path: 'path', message: error.message, code: 'path_denied' }],
      {
        title: 'Path outside the workspace',
        description:
          'Karo only reads and writes inside /workspace. Use a path relative to the project root.',
      },
    );
  }

  if (error instanceof SandboxError) return sandboxToApiError(error);

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return new TimeoutError(error.message);
    }
    // Postgres unique-violation, surfaced by postgres.js as `code: '23505'`.
    if ((error as { code?: unknown }).code === '23505') {
      return new ConflictError('That value is already taken.');
    }
    return new InternalError(error.message, error);
  }

  return new InternalError(typeof error === 'string' ? error : 'Unknown error');
}
