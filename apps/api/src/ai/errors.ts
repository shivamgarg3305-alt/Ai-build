export type AiErrorKind =
  | 'not_configured'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'timeout'
  | 'network'
  | 'cancelled'
  | 'bad_request'
  | 'content_blocked'
  | 'malformed_response'
  | 'provider_unavailable'
  | 'unknown';

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set(['network', 'provider_unavailable']);

/**
 * A provider failure in provider-neutral form. `message` is always safe to show a user; `detail` is for
 * server logs only (already stripped of anything resembling a key and truncated).
 */
export class AiProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;
  readonly httpStatus: number | undefined;
  readonly detail: string | undefined;

  constructor(
    readonly kind: AiErrorKind,
    message: string,
    options: { retryAfterSeconds?: number; httpStatus?: number; detail?: string } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.retryable = RETRYABLE.has(kind);
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.httpStatus = options.httpStatus;
    // Sanitised here, at the source, so no provider (present or future) can put a key-shaped string in a log.
    this.detail = options.detail === undefined ? undefined : sanitizeProviderText(options.detail);
  }
}

/** Removes anything shaped like a Google API key and bounds the length, so provider text is safe to log. */
export function sanitizeProviderText(text: string, max = 240): string {
  return text.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, max);
}
