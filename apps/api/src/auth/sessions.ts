import type { Database } from '../db/types';
import type { AuthContext } from '../app-env';

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** HMAC-SHA256 of the token keyed by SESSION_SECRET. Only this digest is stored, never the token. */
export async function hashToken(secret: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(token)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createSession(
  db: Database,
  secret: string,
  userId: string,
  ttlHours: number,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
  await db.run('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', [
    crypto.randomUUID(),
    userId,
    await hashToken(secret, token),
    expiresAt,
    now.toISOString(),
  ]);
  return { token, expiresAt };
}

export async function resolveSession(
  db: Database,
  secret: string,
  token: string,
  now: Date,
): Promise<AuthContext | null> {
  const row = await db.first<{ id: string; user_id: string; expires_at: string }>(
    'SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?',
    [await hashToken(secret, token)],
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now.getTime()) {
    await db.run('DELETE FROM sessions WHERE id = ?', [row.id]);
    return null;
  }
  return { sessionId: row.id, userId: row.user_id };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
}
