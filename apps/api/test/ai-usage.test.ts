import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeUsage, getUsageSnapshot, quotaDay, reserveUsage, secondsUntilQuotaDayEnds, type ReserveInput } from '../src/ai/usage';
import { migrateSqlite } from '../src/db/migrate-node';
import { SqliteDatabase } from '../src/db/sqlite';
import { MIGRATIONS_DIR } from './helpers';

const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-11-15T12:00:00.000Z'); // 04:00 Pacific
let db: SqliteDatabase;

beforeEach(async () => {
  db = SqliteDatabase.open(':memory:');
  migrateSqlite(db, MIGRATIONS_DIR);
  await db.run("INSERT INTO users (id, email, display_name, password_hash) VALUES ('u1', 'a@b.test', 'A', 'h')");
});

const input = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  userId: 'u1', requestId: 'req-1', provider: 'gemini', model: 'm1', attempt: 1, estimatedTokens: 100,
  limits: { requestsPerMinute: 100, requestsPerDay: 100, tokensPerDay: 1_000_000 }, timeZone: TZ, now: NOW,
  instruction: { permanentFingerprint: 'pf', fingerprint: 'f', versions: { identity: '1.0.0' } }, ...over,
});

describe('quota day', () => {
  it('follows Google\'s midnight Pacific reset', () => {
    expect(quotaDay(new Date('2026-11-15T07:59:30Z'), TZ)).toBe('2026-11-14'); // 23:59:30 PST
    expect(quotaDay(new Date('2026-11-15T08:00:00Z'), TZ)).toBe('2026-11-15'); // 00:00:00 PST
    expect(secondsUntilQuotaDayEnds(new Date('2026-11-15T07:59:30Z'), TZ)).toBe(30);
    expect(secondsUntilQuotaDayEnds(new Date('2026-11-15T08:00:00Z'), TZ)).toBe(86_400);
  });
});

describe('usage reservation', () => {
  it('enforces the per-minute limit and says when to retry', async () => {
    const limits = { requestsPerMinute: 2, requestsPerDay: 100, tokensPerDay: 1_000_000 };
    expect((await reserveUsage(db, input({ limits }))).ok).toBe(true);
    expect((await reserveUsage(db, input({ limits }))).ok).toBe(true);
    const third = await reserveUsage(db, input({ limits }));
    expect(third).toMatchObject({ ok: false, reason: 'per_minute', source: 'local' });
    if (!third.ok) expect(third.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // A minute later the window has moved on.
    expect((await reserveUsage(db, input({ limits, now: new Date(NOW.getTime() + 61_000) }))).ok).toBe(true);
  });

  it('enforces the daily request limit until the quota day resets', async () => {
    const limits = { requestsPerMinute: 100, requestsPerDay: 2, tokensPerDay: 1_000_000 };
    await reserveUsage(db, input({ limits }));
    await reserveUsage(db, input({ limits, now: new Date(NOW.getTime() + 120_000) }));
    const refused = await reserveUsage(db, input({ limits, now: new Date(NOW.getTime() + 240_000) }));
    expect(refused).toMatchObject({ ok: false, reason: 'per_day_requests', source: 'local' });
    if (!refused.ok) expect(refused.retryAfterSeconds).toBe(secondsUntilQuotaDayEnds(new Date(NOW.getTime() + 240_000), TZ));
    // After Pacific midnight the count starts again.
    const nextDay = new Date('2026-11-15T08:00:00Z'); // 00:00 PST on the 15th; NOW is 04:00 PST, same day -> use the 16th
    expect(quotaDay(nextDay, TZ)).toBe(quotaDay(NOW, TZ));
    expect((await reserveUsage(db, input({ limits, now: new Date('2026-11-16T09:00:00Z') }))).ok).toBe(true);
  });

  it('enforces the daily token budget using estimates, then actual usage once reported', async () => {
    const limits = { requestsPerMinute: 100, requestsPerDay: 100, tokensPerDay: 1000 };
    const first = await reserveUsage(db, input({ limits, estimatedTokens: 600 }));
    expect(first.ok).toBe(true);
    expect(await reserveUsage(db, input({ limits, estimatedTokens: 600 }))).toMatchObject({ ok: false, reason: 'per_day_tokens' });
    // The provider reports only 100 tokens were really used, which frees the budget.
    if (first.ok) await finalizeUsage(db, first.id, { status: 'completed', inputTokens: 70, outputTokens: 30, latencyMs: 5, now: NOW });
    expect((await reserveUsage(db, input({ limits, estimatedTokens: 600 }))).ok).toBe(true);
  });

  it('cannot be overshot by concurrent requests (the check and the insert are one statement)', async () => {
    const limits = { requestsPerMinute: 3, requestsPerDay: 100, tokensPerDay: 1_000_000 };
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveUsage(db, input({ limits }))));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await db.all('SELECT id FROM ai_usage')).toHaveLength(3);
  });

  it('stops sending to a provider that is cooling down, then resumes', async () => {
    const reserved = await reserveUsage(db, input());
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const blockedUntil = new Date(NOW.getTime() + 90_000);
    await finalizeUsage(db, reserved.id, { status: 'rate_limited', errorKind: 'rate_limited', latencyMs: 5, blockedUntil, now: NOW });

    const during = await reserveUsage(db, input({ now: new Date(NOW.getTime() + 30_000) }));
    expect(during).toMatchObject({ ok: false, reason: 'cooldown', source: 'provider', blockedKind: 'rate_limited', retryAfterSeconds: 60 });
    // A different model is not blocked.
    expect((await reserveUsage(db, input({ model: 'other-model', now: new Date(NOW.getTime() + 30_000) }))).ok).toBe(true);
    // Once the cool-down has passed, requests flow again.
    expect((await reserveUsage(db, input({ now: new Date(NOW.getTime() + 91_000) }))).ok).toBe(true);
  });

  it('records usage and a snapshot, and stores no conversation content', async () => {
    const reserved = await reserveUsage(db, input());
    if (reserved.ok) await finalizeUsage(db, reserved.id, { status: 'completed', inputTokens: 80, outputTokens: 20, latencyMs: 12, now: NOW });
    const snapshot = await getUsageSnapshot(db, { provider: 'gemini', model: 'm1', timeZone: TZ, now: NOW });
    expect(snapshot).toMatchObject({ requestsToday: 1, tokensToday: 100, requestsLastMinute: 1, blockedUntil: null, blockedReason: null });

    const columns = (await db.all<{ name: string }>('PRAGMA table_info(ai_usage)')).map((c) => c.name);
    expect(columns).not.toEqual(expect.arrayContaining(['prompt']));
    for (const forbidden of ['prompt', 'message', 'content', 'text', 'instruction', 'response']) expect(columns).not.toContain(forbidden);
    const row = await db.first<Record<string, unknown>>('SELECT * FROM ai_usage');
    expect(row).toMatchObject({ request_id: 'req-1', provider: 'gemini', model: 'm1', status: 'completed', total_tokens: 100, permanent_fingerprint: 'pf', instruction_fingerprint: 'f' });
    expect(JSON.parse(String(row?.['instruction_versions']))).toEqual({ identity: '1.0.0' });
  });
});
