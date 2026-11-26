import { Hono } from 'hono';
import type { HealthResponse } from '@assistant/shared';
import type { AppEnv } from '../../app-env';
import { getCoreLayers } from '../../assistant/core';
import { ensureInstructionRevisions } from '../../assistant/ledger';
import type { Services } from '../../services';

const REQUIRED_TABLES = ['users', 'instruction_revisions', 'personality_settings', 'user_preferences', 'ai_usage'] as const;

export function healthRoutes(services: Services) {
  const routes = new Hono<AppEnv>();

  routes.get('/', async (c) => {
    const log = c.get('logger');
    const started = performance.now();
    let dbStatus: 'ok' | 'error' = 'ok';
    let schema: 'ready' | 'missing' | 'unknown' = 'unknown';
    try {
      await services.db.ping();
      const found = await services.db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`,
        [...REQUIRED_TABLES],
      );
      schema = found.length === REQUIRED_TABLES.length ? 'ready' : 'missing';
    } catch (err) {
      dbStatus = 'error';
      log.error('health check: database unavailable', { err });
    }
    const latencyMs = Math.round((performance.now() - started) * 10) / 10;

    // The permanent identity layers are verified against the persisted ledger.
    let instructionsStatus: 'ok' | 'error' = 'error';
    if (dbStatus === 'ok' && schema === 'ready') {
      try {
        await ensureInstructionRevisions(services.db);
        instructionsStatus = 'ok';
      } catch (err) {
        log.error('health check: instruction integrity failed', { err });
      }
    }
    const version = (id: 'identity' | 'constitution' | 'personality', layers: Awaited<ReturnType<typeof getCoreLayers>>) =>
      layers.find((layer) => layer.id === id)?.version ?? 'unknown';
    const layers = await getCoreLayers();

    const healthy = dbStatus === 'ok' && schema === 'ready' && instructionsStatus === 'ok';
    const body: HealthResponse = {
      status: healthy ? 'ok' : 'degraded',
      version: services.config.version,
      environment: services.config.env,
      time: new Date().toISOString(),
      checks: {
        database: { status: dbStatus, driver: services.db.driver, latencyMs, schema },
        instructions: {
          status: instructionsStatus,
          identityVersion: version('identity', layers),
          constitutionVersion: version('constitution', layers),
          personalityVersion: version('personality', layers),
        },
      },
    };
    return c.json(body, healthy ? 200 : 503);
  });

  return routes;
}
