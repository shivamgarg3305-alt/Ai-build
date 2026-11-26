import type { PublicUser } from '@assistant/shared';
import type { Database } from '../db/types';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: string;
}

const toPublic = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  createdAt: row.created_at,
});

/**
 * This is a single-owner assistant: the first registration wins and every later
 * attempt is refused. The INSERT ... WHERE NOT EXISTS makes that check atomic,
 * so two simultaneous registrations cannot both succeed. Returns null if closed.
 */
export async function registerFirstUser(
  db: Database,
  input: { email: string; displayName: string; passwordHash: string },
  now: Date,
): Promise<PublicUser | null> {
  const id = crypto.randomUUID();
  const ts = now.toISOString();
  const { changes } = await db.run(
    `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
    [id, input.email, input.displayName, input.passwordHash, ts, ts],
  );
  if (changes === 0) return null;
  return { id, email: input.email, displayName: input.displayName, createdAt: ts };
}

export async function findUserByEmail(
  db: Database,
  email: string,
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const row = await db.first<UserRow>('SELECT * FROM users WHERE email = ?', [email]);
  return row ? { ...toPublic(row), passwordHash: row.password_hash } : null;
}

export async function findUserById(db: Database, id: string): Promise<PublicUser | null> {
  const row = await db.first<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  return row ? toPublic(row) : null;
}
