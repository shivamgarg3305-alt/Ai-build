import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiProviderRegistry } from '../src/ai/registry';
import { InProcessJobRunner } from '../src/jobs/in-process';
import { createLogger } from '../src/logger';

const logger = createLogger({ level: 'silent' });

describe('InProcessJobRunner', () => {
  it('runs a registered job with a validated payload', async () => {
    const runner = new InProcessJobRunner(logger, () => 1);
    const seen: number[] = [];
    runner.register({ name: 'add', payload: z.object({ n: z.number() }), run: async ({ n }) => void seen.push(n) });
    await runner.enqueue('add', { n: 4 });
    await runner.idle();
    expect(seen).toEqual([4]);
  });

  it('retries failures and succeeds on a later attempt', async () => {
    const runner = new InProcessJobRunner(logger, () => 1);
    let calls = 0;
    runner.register({
      name: 'flaky',
      payload: z.object({}),
      run: async (_p, { attempt }) => {
        calls++;
        if (attempt < 3) throw new Error('try again');
      },
    });
    await runner.enqueue('flaky', {});
    await runner.idle();
    expect(calls).toBe(3);
  });

  it('gives up after maxAttempts without throwing into the caller', async () => {
    const runner = new InProcessJobRunner(logger, () => 1);
    let calls = 0;
    runner.register({ name: 'doomed', payload: z.object({}), maxAttempts: 2, run: async () => { calls++; throw new Error('no'); } });
    await runner.enqueue('doomed', {});
    await expect(runner.idle()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('rejects unknown jobs and invalid payloads at enqueue time', async () => {
    const runner = new InProcessJobRunner(logger);
    runner.register({ name: 'typed', payload: z.object({ n: z.number() }), run: async () => {} });
    await expect(runner.enqueue('missing', {})).rejects.toThrow(/Unknown job/);
    await expect(runner.enqueue('typed', { n: 'x' })).rejects.toThrow();
    expect(() => runner.register({ name: 'typed', payload: z.object({}), run: async () => {} })).toThrow(/already registered/);
  });
});

describe('AiProviderRegistry', () => {
  const fake = (name: string) => ({ name, generate: async () => ({ text: name, model: 'fake' }) });

  it('throws a 501 when no provider is configured', () => {
    expect(() => new AiProviderRegistry().get()).toThrow(expect.objectContaining({ status: 501, code: 'ai_provider_not_configured' }));
  });

  it('returns the first registered provider by default, or the one asked for', async () => {
    const registry = new AiProviderRegistry();
    registry.register(fake('a'));
    registry.register(fake('b'));
    expect(registry.get().name).toBe('a');
    expect(registry.get('b').name).toBe('b');
    expect(registry.list()).toEqual(['a', 'b']);
    registry.register(fake('c'), { default: true });
    expect(registry.get().name).toBe('c');
    expect(() => registry.register(fake('a'))).toThrow(/already registered/);
  });
});
