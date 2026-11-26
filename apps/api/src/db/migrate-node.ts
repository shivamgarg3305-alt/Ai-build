import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqliteDatabase } from './sqlite';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies the numbered .sql files in `dir` in filename order, once each, each
 * inside its own transaction. Progress is tracked in the _migrations table.
 * (On Cloudflare D1 use `wrangler d1 migrations apply`, which reads the same files.)
 */
export function migrateSqlite(db: SqliteDatabase, dir: string): MigrationResult {
  const { raw } = db;
  raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    (raw.prepare('SELECT name FROM _migrations').all() as unknown as { name: string }[]).map((row) => row.name),
  );
  const files = readdirSync(dir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    if (done.has(file)) {
      result.skipped.push(file);
      continue;
    }
    raw.exec('BEGIN');
    try {
      raw.exec(readFileSync(join(dir, file), 'utf8'));
      raw.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    result.applied.push(file);
  }
  return result;
}
