import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** An error that is safe to show to API clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(details: unknown): AppError {
    return new AppError(400, 'validation_error', 'The request did not pass validation.', details);
  }
  static unauthorized(message = 'Authentication is required.', code = 'unauthorized'): AppError {
    return new AppError(401, code, message);
  }
  static forbidden(code: string, message: string): AppError {
    return new AppError(403, code, message);
  }
  static notFound(message = 'The requested resource was not found.'): AppError {
    return new AppError(404, 'not_found', message);
  }
  static notImplemented(code: string, message: string): AppError {
    return new AppError(501, code, message);
  }
}
