import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/env';
import { ConfigError } from '../src/errors';
import { SECRET } from './helpers';

describe('loadConfig', () => {
  it('applies secure defaults', () => {
    const config = loadConfig({ SESSION_SECRET: SECRET });
    expect(config).toMatchObject({
      env: 'development',
      host: '127.0.0.1',
      port: 8787,
      corsOrigins: ['http://localhost:5173'],
      sessionTtlHours: 720,
    });
  });

  it('parses overrides and splits CORS origins', () => {
    const config = loadConfig({ SESSION_SECRET: SECRET, API_PORT: '9000', CORS_ORIGINS: 'https://a.test, https://b.test' });
    expect(config.port).toBe(9000);
    expect(config.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
  });

  it('ignores non-string values such as platform bindings', () => {
    expect(() => loadConfig({ SESSION_SECRET: SECRET, DB: { prepare() {} } })).not.toThrow();
  });

  it('requires SESSION_SECRET', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/SESSION_SECRET/);
  });

  it('never echoes secret values in errors', () => {
    try {
      loadConfig({ SESSION_SECRET: 'abc123' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('SESSION_SECRET');
      expect((error as Error).message).not.toContain('abc123');
    }
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ SESSION_SECRET: SECRET, API_PORT: '70000' })).toThrow(/API_PORT/);
  });
});
