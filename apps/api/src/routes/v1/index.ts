import { Hono } from 'hono';
import type { AppEnv } from '../../app-env';
import type { Services } from '../../services';
import { assistantRoutes } from './assistant';
import { authRoutes } from './auth';
import { healthRoutes } from './health';

export function v1Routes(services: Services) {
  const routes = new Hono<AppEnv>();
  routes.route('/health', healthRoutes(services));
  routes.route('/auth', authRoutes(services));
  routes.route('/assistant', assistantRoutes(services));
  return routes;
}
