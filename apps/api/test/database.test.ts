import { describe, expect, it } from 'vitest';
import { migrateSqlite } from '../src/db/migrate-node';
import { SqliteDatabase } from '../src/db/sqlite';
import { MIGRATIONS_DIR } from './helpers';

const EXPECTED_TABLES = [
  'actions', 'ai_usage', 'attachments', 'audit_logs', 'conversations', 'instruction_revisions', 'memories',
  'messages', 'permissions', 'personality_settings', 'projects', 'sessions', 'tasks',
  'user_preferences', 'users',
];
const MIGRATION_FILES = ['0001_initial.sql', '0002_assistant_instructions.sql', '0003_ai_usage.sql'];

describe('migrations', () => {
  it('create every table and are idempotent', async () => {
    const db = SqliteDatabase.open(':memory:');
    const first = migrateSqlite(db, MIGRATIONS_DIR);
    expect(first.applied).toEqual(MIGRATION_FILES);
    const second = migrateSqlite(db, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(MIGRATION_FILES);

    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
  });
});

describe('SqliteDatabase', () => {
  async function fresh() {
    const db = SqliteDatabase.open(':memory:');
    migrateSqlite(db, MIGRATIONS_DIR);
    return db;
  }

  it('answers ping and parameterised queries', async () => {
    const db = await fresh();
    await expect(db.ping()).resolves.toBeUndefined();
    const { changes } = await db.run(
      'INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)',
      ['u1', 'a@b.test', 'A', 'h'],
    );
    expect(changes).toBe(1);
    expect(await db.first<{ email: string }>('SELECT email FROM users WHERE id = ?', ['u1'])).toEqual(
      expect.objectContaining({ email: 'a@b.test' }),
    );
    expect(await db.first('SELECT * FROM users WHERE id = ?', ['missing'])).toBeNull();
  });

  it('enforces foreign keys', async () => {
    const db = await fresh();
    await expect(
      db.run("INSERT INTO messages (id, conversation_id, role, content) VALUES ('m', 'nope', 'user', 'hi')"),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('rolls back a failed batch entirely', async () => {
    const db = await fresh();
    await expect(
      db.batch([
        { sql: 'INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)', params: ['u1', 'a@b.test', 'A', 'h'] },
        { sql: 'INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)', params: ['u2', 'a@b.test', 'B', 'h'] },
      ]),
    ).rejects.toThrow(/UNIQUE/i);
    expect(await db.all('SELECT id FROM users')).toHaveLength(0);
  });
});
