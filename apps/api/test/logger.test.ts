import { describe, expect, it } from 'vitest';
import { createLogger, redact } from '../src/logger';

describe('logger', () => {
  it('emits JSON lines and respects the level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', sink: (line) => lines.push(line) });
    log.info('hidden');
    log.warn('shown', { a: 1 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', msg: 'shown', a: 1 });
  });

  it('merges child bindings', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', sink: (line) => lines.push(line) }).child({ requestId: 'r1' });
    log.info('hello');
    expect(JSON.parse(lines[0]!)).toMatchObject({ requestId: 'r1' });
  });

  it('redacts sensitive keys, including nested ones', () => {
    expect(redact({ password: 'p', nested: { Authorization: 'Bearer x', ok: 'fine' }, tokenHash: 'h' })).toEqual({
      password: '[redacted]',
      nested: { Authorization: '[redacted]', ok: 'fine' },
      tokenHash: '[redacted]',
    });
  });

  it('serialises errors and bigint values', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'error', sink: (line) => lines.push(line) });
    log.error('boom', { err: new Error('bad'), big: 10n });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.err.message).toBe('bad');
    expect(parsed.big).toBe('10');
  });

  it('is silent when level is silent', () => {
    const lines: string[] = [];
    createLogger({ level: 'silent', sink: (line) => lines.push(line) }).error('x');
    expect(lines).toHaveLength(0);
  });
});
