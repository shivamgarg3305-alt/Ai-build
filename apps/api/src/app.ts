import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX } from '@assistant/shared';
import type { AppEnv } from './app-env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestContext } from './middleware/request-context';
import { v1Routes } from './routes/v1';
import type { Services } from './services';

/** Builds the HTTP app. Runtime-agnostic: no Node or Cloudflare APIs are imported here. */
export function createApp(services: Services) {
  const app = new Hono<AppEnv>();

  app.use('*', requestContext(services.logger));
  app.use('*', secureHeaders());
  app.use(
    '/api/*',
    cors({
      origin: services.config.corsOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: 'payload_too_large', message: 'Request body is too large.', requestId: c.get('requestId') } },
          413,
        ),
    }),
  );

  app.route(API_PREFIX, v1Routes(services));

  app.notFound(notFoundHandler);
  app.onError(errorHandler);
  return app;
}
