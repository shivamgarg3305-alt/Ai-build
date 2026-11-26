import { errorResponseSchema, healthResponseSchema } from '@assistant/shared';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/db/types';
import { createTestApp } from './helpers';

describe('GET /api/v1/health', () => {
  it('reports ok with a connected, migrated database', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe('ok');
    expect(body.checks.database).toMatchObject({ status: 'ok', driver: 'sqlite', schema: 'ready' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('reports degraded (503) when migrations have not been applied', async () => {
    const { app } = createTestApp({ migrate: false });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(503);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe('degraded');
    expect(body.checks.database.schema).toBe('missing');
  });

  it('reports degraded (503) when the database is unreachable', async () => {
    const fail = () => Promise.reject(new Error('db down'));
    const broken: Database = { driver: 'sqlite', all: fail, first: fail, run: fail, batch: fail, ping: fail };
    const { app } = createTestApp({ overrides: { db: broken } });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(503);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.checks.database.status).toBe('error');
    expect(JSON.stringify(body)).not.toContain('db down');
  });

  it('echoes a valid inbound request id and replaces an invalid one', async () => {
    const { app } = createTestApp();
    const ok = await app.request('/api/v1/health', { headers: { 'x-request-id': 'req-12345678' } });
    expect(ok.headers.get('x-request-id')).toBe('req-12345678');
    const bad = await app.request('/api/v1/health', { headers: { 'x-request-id': 'bad id!' } });
    expect(bad.headers.get('x-request-id')).not.toBe('bad id!');
  });
});

describe('platform behaviour', () => {
  it('returns a JSON 404 in the standard error shape', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/nope');
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  it('hides unexpected error details behind a generic 500', async () => {
    const throwing: Database = {
      driver: 'sqlite',
      all: () => Promise.reject(new Error('secret internals')),
      first: () => Promise.reject(new Error('secret internals')),
      run: () => Promise.reject(new Error('secret internals')),
      batch: () => Promise.reject(new Error('secret internals')),
      ping: () => Promise.resolve(),
    };
    const { app } = createTestApp({ overrides: { db: throwing } });
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.test', password: 'whatever-password' }),
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret internals');
    expect(errorResponseSchema.parse(JSON.parse(text)).error.code).toBe('internal_error');
  });

  it('allows configured CORS origins only', async () => {
    const { app } = createTestApp();
    const allowed = await app.request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const denied = await app.request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects oversized bodies with 413', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) },
      body: JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('sets secure headers', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
