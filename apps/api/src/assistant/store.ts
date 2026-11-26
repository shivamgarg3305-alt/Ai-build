import { DEFAULT_PERSONALITY_SETTINGS, personalitySettingsSchema, type PersonalitySettings, type Preference } from '@assistant/shared';
import type { Database } from '../db/types';

export async function getPersonalitySettings(
  db: Database,
  userId: string,
): Promise<{ settings: PersonalitySettings; revision: number }> {
  const row = await db.first<{ settings: string; revision: number }>(
    'SELECT settings, revision FROM personality_settings WHERE user_id = ?',
    [userId],
  );
  if (!row) return { settings: { ...DEFAULT_PERSONALITY_SETTINGS }, revision: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.settings);
  } catch {
    parsed = undefined;
  }
  const result = personalitySettingsSchema.safeParse(parsed);
  // Corrupt stored settings fall back to defaults rather than breaking every response.
  return { settings: result.success ? result.data : { ...DEFAULT_PERSONALITY_SETTINGS }, revision: row.revision };
}

export async function savePersonalitySettings(
  db: Database,
  userId: string,
  settings: PersonalitySettings,
  now: Date,
): Promise<number> {
  await db.run(
    `INSERT INTO personality_settings (user_id, settings, revision, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, revision = revision + 1, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(settings), now.toISOString()],
  );
  return (await getPersonalitySettings(db, userId)).revision;
}

export async function listPreferences(db: Database, userId: string): Promise<Preference[]> {
  return db.all<Preference>(
    'SELECT id, text, created_at AS createdAt FROM user_preferences WHERE user_id = ? ORDER BY created_at, id',
    [userId],
  );
}

export async function countPreferences(db: Database, userId: string): Promise<number> {
  const row = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM user_preferences WHERE user_id = ?', [userId]);
  return row?.n ?? 0;
}

export async function addPreference(db: Database, userId: string, text: string, now: Date): Promise<Preference> {
  const preference: Preference = { id: crypto.randomUUID(), text, createdAt: now.toISOString() };
  await db.run('INSERT INTO user_preferences (id, user_id, text, created_at) VALUES (?, ?, ?, ?)', [
    preference.id,
    userId,
    preference.text,
    preference.createdAt,
  ]);
  return preference;
}

export async function removePreference(db: Database, userId: string, id: string): Promise<boolean> {
  const { changes } = await db.run('DELETE FROM user_preferences WHERE id = ? AND user_id = ?', [id, userId]);
  return changes > 0;
}
