// Cloudflare Workers entry point (D1 database). Imports nothing Node-specific.
import { AiProviderRegistry } from './ai/registry';
import { registerAiProviders } from './ai/setup';
import { createApp } from './app';
import { D1Adapter, type D1DatabaseLike } from './db/d1';
import { loadConfig } from './env';
import { InProcessJobRunner } from './jobs/in-process';
import { createLogger } from './logger';

interface WorkerEnv {
  DB: D1DatabaseLike;
  [key: string]: unknown;
}

let app: ReturnType<typeof createApp> | undefined;

function getApp(env: WorkerEnv) {
  if (!app) {
    const config = loadConfig(env);
    const logger = createLogger({ level: config.logLevel, bindings: { service: 'api' } });
    const ai = new AiProviderRegistry();
    registerAiProviders(ai, config);
    app = createApp({
      config,
      logger,
      db: new D1Adapter(env.DB),
      ai,
      jobs: new InProcessJobRunner(logger),
    });
  }
  return app;
}

export default {
  fetch(request: Request, env: WorkerEnv): Response | Promise<Response> {
    return getApp(env).fetch(request);
  },
};
