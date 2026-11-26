import type { Database, SqlStatement, SqlValue } from './types';

// Structural subset of the Cloudflare D1 binding, so this file needs no
// Cloudflare type packages and nothing here is Node-specific.
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
}
export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

export class D1Adapter implements Database {
  readonly driver = 'd1' as const;

  constructor(private readonly d1: D1DatabaseLike) {}

  private stmt(sql: string, params: SqlValue[]): D1PreparedStatementLike {
    const prepared = this.d1.prepare(sql);
    return params.length > 0 ? prepared.bind(...params) : prepared;
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return (await this.stmt(sql, params).all<T>()).results;
  }

  async first<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return (await this.stmt(sql, params).first<T>()) ?? null;
  }

  async run(sql: string, params: SqlValue[] = []): Promise<{ changes: number }> {
    const result = await this.stmt(sql, params).run();
    return { changes: result.meta.changes ?? 0 };
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    await this.d1.batch(statements.map(({ sql, params = [] }) => this.stmt(sql, params)));
  }

  async ping(): Promise<void> {
    await this.stmt('SELECT 1', []).first();
  }
}
