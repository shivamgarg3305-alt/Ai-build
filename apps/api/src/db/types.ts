export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

/**
 * The only database surface the application code may use. Two adapters exist:
 * node:sqlite (local dev, tests, self-hosting) and Cloudflare D1 (Workers).
 * Both speak SQLite SQL, so the same migrations run on either.
 */
export interface Database {
  readonly driver: 'sqlite' | 'd1';
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Runs all statements atomically: either every statement applies or none do. */
  batch(statements: SqlStatement[]): Promise<void>;
  /** Throws if the database cannot be reached. */
  ping(): Promise<void>;
  close?(): Promise<void>;
}
