import type { Database } from '../db/types';
import type { AiErrorKind } from './errors';

export interface UsageLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
}

/** The day Google's daily quota is counted in: it resets at midnight Pacific time. */
export function quotaDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function secondsUntilQuotaDayEnds(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .format(now)
    .split(':')
    .map(Number);
  const elapsed = (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return Math.max(1, 86_400 - elapsed);
}

export interface ReserveInput {
  userId: string;
  requestId: string;
  provider: string;
  model: string;
  attempt: number;
  estimatedTokens: number;
  limits: UsageLimits;
  timeZone: string;
  now: Date;
  instruction: { permanentFingerprint: string; fingerprint: string; versions: Record<string, string> };
}

export type ReserveResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'cooldown' | 'per_minute' | 'per_day_requests' | 'per_day_tokens';
      retryAfterSeconds: number;
      source: 'local' | 'provider';
      /** For a cool-down: the kind of provider failure that caused it. */
      blockedKind?: string;
      blockedUntil?: string;
    };

const iso = (date: Date) => date.toISOString();

/**
 * Atomically checks every limit and records the attempt in ONE statement, so concurrent requests cannot
 * all pass the check and overshoot. The row counts against the limits from the moment it is reserved.
 * Nothing about the conversation (no prompt, no message, no instruction text) is stored.
 */
export async function reserveUsage(db: Database, input: ReserveInput): Promise<ReserveResult> {
  const { now, limits, provider, model } = input;
  const day = quotaDay(now, input.timeZone);
  const windowStart = iso(new Date(now.getTime() - 60_000));
  const id = crypto.randomUUID();

  const { changes } = await db.run(
    `INSERT INTO ai_usage (id, user_id, request_id, provider, model, status, attempt, estimated_tokens,
                           permanent_fingerprint, instruction_fingerprint, instruction_versions, day, created_at)
     SELECT ?, ?, ?, ?, ?, 'started', ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM ai_usage WHERE created_at >= ?) < ?
       AND (SELECT COUNT(*) FROM ai_usage WHERE day = ?) < ?
       AND (SELECT COALESCE(SUM(COALESCE(total_tokens, estimated_tokens)), 0) FROM ai_usage WHERE day = ?) + ? <= ?
       AND NOT EXISTS (SELECT 1 FROM ai_usage WHERE provider = ? AND model = ? AND blocked_until > ?)`,
    [
      id, input.userId, input.requestId, provider, model, input.attempt, input.estimatedTokens,
      input.instruction.permanentFingerprint, input.instruction.fingerprint, JSON.stringify(input.instruction.versions), day, iso(now),
      windowStart, limits.requestsPerMinute,
      day, limits.requestsPerDay,
      day, input.estimatedTokens, limits.tokensPerDay,
      provider, model, iso(now),
    ],
  );
  if (changes > 0) return { ok: true, id };

  // Refused: work out which limit, so the caller can say so precisely.
  const blocked = await db.first<{ blocked_until: string; error_kind: string | null }>(
    'SELECT blocked_until, error_kind FROM ai_usage WHERE provider = ? AND model = ? AND blocked_until > ? ORDER BY blocked_until DESC LIMIT 1',
    [provider, model, iso(now)],
  );
  if (blocked) {
    const seconds = Math.max(1, Math.ceil((Date.parse(blocked.blocked_until) - now.getTime()) / 1000));
    return { ok: false, reason: 'cooldown', retryAfterSeconds: seconds, source: 'provider', blockedKind: blocked.error_kind ?? 'unknown', blockedUntil: blocked.blocked_until };
  }
  const recent = await db.first<{ n: number; oldest: string | null }>('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM ai_usage WHERE created_at >= ?', [windowStart]);
  if ((recent?.n ?? 0) >= limits.requestsPerMinute) {
    const age = recent?.oldest ? now.getTime() - Date.parse(recent.oldest) : 0;
    return { ok: false, reason: 'per_minute', retryAfterSeconds: Math.max(1, Math.ceil((60_000 - age) / 1000)), source: 'local' };
  }
  const today = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM ai_usage WHERE day = ?', [day]);
  const untilReset = secondsUntilQuotaDayEnds(now, input.timeZone);
  if ((today?.n ?? 0) >= limits.requestsPerDay) return { ok: false, reason: 'per_day_requests', retryAfterSeconds: untilReset, source: 'local' };
  return { ok: false, reason: 'per_day_tokens', retryAfterSeconds: untilReset, source: 'local' };
}

export interface UsageOutcome {
  status: 'completed' | 'incomplete' | 'error' | 'rate_limited' | 'quota_exhausted' | 'cancelled' | 'timeout';
  errorKind?: AiErrorKind;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  blockedUntil?: Date;
  now: Date;
}

export async function finalizeUsage(db: Database, id: string, outcome: UsageOutcome): Promise<void> {
  const input = outcome.inputTokens ?? 0;
  const output = outcome.outputTokens ?? 0;
  await db.run(
    `UPDATE ai_usage SET status = ?, error_kind = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?,
            latency_ms = ?, blocked_until = ?, completed_at = ? WHERE id = ?`,
    [
      outcome.status, outcome.errorKind ?? null, input, output, input + output,
      outcome.latencyMs, outcome.blockedUntil ? iso(outcome.blockedUntil) : null, iso(outcome.now), id,
    ],
  );
}

export interface UsageSnapshot {
  quotaDay: string;
  requestsToday: number;
  tokensToday: number;
  requestsLastMinute: number;
  blockedUntil: string | null;
  blockedReason: string | null;
}

export async function getUsageSnapshot(db: Database, args: { provider: string; model: string; timeZone: string; now: Date }): Promise<UsageSnapshot> {
  const { now } = args;
  const day = quotaDay(now, args.timeZone);
  const [requests, tokens, minute, blocked] = await Promise.all([
    db.first<{ n: number }>('SELECT COUNT(*) AS n FROM ai_usage WHERE day = ?', [day]),
    db.first<{ n: number }>('SELECT COALESCE(SUM(COALESCE(total_tokens, estimated_tokens)), 0) AS n FROM ai_usage WHERE day = ?', [day]),
    db.first<{ n: number }>('SELECT COUNT(*) AS n FROM ai_usage WHERE created_at >= ?', [iso(new Date(now.getTime() - 60_000))]),
    db.first<{ blocked_until: string; error_kind: string | null }>(
      'SELECT blocked_until, error_kind FROM ai_usage WHERE provider = ? AND model = ? AND blocked_until > ? ORDER BY blocked_until DESC LIMIT 1',
      [args.provider, args.model, iso(now)],
    ),
  ]);
  return {
    quotaDay: day,
    requestsToday: requests?.n ?? 0,
    tokensToday: tokens?.n ?? 0,
    requestsLastMinute: minute?.n ?? 0,
    blockedUntil: blocked?.blocked_until ?? null,
    blockedReason: blocked ? (blocked.error_kind ?? 'unknown') : null,
  };
}
