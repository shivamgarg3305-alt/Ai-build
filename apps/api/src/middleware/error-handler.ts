import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ErrorResponse } from '@assistant/shared';
import type { AppEnv } from '../app-env';
import { AppError } from '../errors';

function body(code: string, message: string, requestId: string | undefined, details?: unknown): ErrorResponse {
  return { error: { code, message, ...(requestId ? { requestId } : {}), ...(details !== undefined ? { details } : {}) } };
}

/** The single place errors become HTTP responses. Unknown errors never leak their message. */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');

  if (err instanceof AppError) {
    (err.status >= 500 ? log.error : log.warn)('request failed', { code: err.code, status: err.status, err });
    const retryAfter = (err.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
    return c.json(body(err.code, err.message, requestId, err.details), err.status);
  }
  if (err instanceof HTTPException) {
    log.warn('http exception', { status: err.status, err });
    return c.json(body('http_error', err.message || 'Request failed.', requestId), err.status);
  }
  log.error('unhandled error', { err });
  return c.json(body('internal_error', 'Something went wrong on the server.', requestId), 500);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(body('not_found', 'The requested resource was not found.', c.get('requestId')), 404);
