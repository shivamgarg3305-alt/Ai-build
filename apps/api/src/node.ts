import { serve } from '@hono/node-server';
import { AiProviderRegistry } from './ai/registry';
import { registerAiProviders } from './ai/setup';
import { createApp } from './app';
import { InstructionIntegrityError, ensureInstructionRevisions } from './assistant/ledger';
import { SqliteDatabase } from './db/sqlite';
import { loadConfig } from './env';
import { ConfigError } from './errors';
import { InProcessJobRunner } from './jobs/in-process';
import { loadDotEnv } from './load-env';
import { createLogger } from './logger';
import type { Services } from './services';
import { LocalFsStorage } from './storage/local';

loadDotEnv();

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    console.error('Run `npm run setup` to create a .env file.');
    process.exit(1);
  }
  throw error;
}

const logger = createLogger({ level: config.logLevel, bindings: { service: 'api' } });
const db = SqliteDatabase.open(config.databasePath);
const jobs = new InProcessJobRunner(logger);
const aiRegistry = new AiProviderRegistry();
registerAiProviders(aiRegistry, config);
logger.info('ai provider', { provider: config.ai.provider, model: config.ai.model, activation: config.ai.activation, registered: aiRegistry.list() });

// Refuse to start if the permanent identity layers changed without a deliberate version bump.
// If the tables are simply not migrated yet, keep running: /health reports it.
try {
  await ensureInstructionRevisions(db);
} catch (error) {
  if (error instanceof InstructionIntegrityError) {
    logger.error('instruction integrity check failed; refusing to start', { err: error });
    process.exit(1);
  }
  logger.warn('instruction ledger not ready; run `npm run db:migrate`', { err: error });
}
const services: Services = {
  config,
  logger,
  db,
  storage: new LocalFsStorage(config.storageDir),
  ai: aiRegistry,
  jobs,
};

const server = serve({ fetch: createApp(services).fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info('api listening', { host: info.address, port: info.port, env: config.env, database: config.databasePath });
});

async function shutdown(signal: string) {
  logger.info('shutting down', { signal });
  server.close();
  await jobs.idle();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
