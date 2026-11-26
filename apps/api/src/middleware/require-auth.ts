import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app-env';
import { resolveSession } from '../auth/sessions';
import { AppError } from '../errors';
import type { Services } from '../services';

export function requireAuth(services: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    if (!match?.[1]) throw AppError.unauthorized();
    const auth = await resolveSession(services.db, services.config.sessionSecret, match[1], new Date());
    if (!auth) throw AppError.unauthorized('Your session is invalid or has expired.', 'invalid_session');
    c.set('auth', auth);
    await next();
  };
}
