import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Database, SqlStatement, SqlValue } from './types';

/** Node-only adapter built on the node:sqlite module (Node >= 22.13). */
export class SqliteDatabase implements Database {
  readonly driver = 'sqlite' as const;

  private constructor(readonly raw: DatabaseSync) {}

  static open(path: string): SqliteDatabase {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    return new SqliteDatabase(raw);
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.raw.prepare(sql).all(...(params as SQLInputValue[])) as unknown as T[];
  }

  async first<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return (this.raw.prepare(sql).get(...(params as SQLInputValue[])) as unknown as T | undefined) ?? null;
  }

  async run(sql: string, params: SqlValue[] = []): Promise<{ changes: number }> {
    const result = this.raw.prepare(sql).run(...(params as SQLInputValue[]));
    return { changes: Number(result.changes) };
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    this.raw.exec('BEGIN');
    try {
      for (const { sql, params = [] } of statements) {
        this.raw.prepare(sql).run(...(params as SQLInputValue[]));
      }
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  async ping(): Promise<void> {
    this.raw.prepare('SELECT 1').get();
  }

  async close(): Promise<void> {
    this.raw.close();
  }
}
