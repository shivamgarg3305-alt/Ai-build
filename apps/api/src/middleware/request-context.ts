import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app-env';
import type { Logger } from '../logger';

/** Assigns a request id, binds a request-scoped logger, and logs one line per request. */
export function requestContext(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    const log = logger.child({ requestId });
    c.set('requestId', requestId);
    c.set('logger', log);
    const started = performance.now();
    await next();
    c.res.headers.set('x-request-id', requestId);
    log.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  };
}
