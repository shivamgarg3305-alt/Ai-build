import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instructionPreviewResponseSchema, assistantIdentityResponseSchema } from '@assistant/shared';
import { InstructionIntegrityError, ensureInstructionRevisions } from '../src/assistant/ledger';
import { migrateSqlite } from '../src/db/migrate-node';
import { SqliteDatabase } from '../src/db/sqlite';
import { MIGRATIONS_DIR, client, createTestApp, loginOwner, registerOwner } from './helpers';

let dir: string;
let dbPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'assistant-persist-'));
  dbPath = join(dir, 'assistant.db');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** Simulates one process lifetime: open the database file, build the app, hand back a way to "stop". */
function boot() {
  const ctx = createTestApp({ dbPath });
  return { ...ctx, stop: () => ctx.db.close!() };
}

async function preview(call: ReturnType<typeof client>) {
  return instructionPreviewResponseSchema.parse(await (await call('POST', '/assistant/instructions/preview', { sessionContext: ['Same session.'] })).json());
}

describe('persistence across restarts', () => {
  it('keeps identical identity instructions and persisted configuration after restart', async () => {
    const first = boot();
    const call1 = client(first.app, await registerOwner(first.app));
    await call1('PUT', '/assistant/personality', { proactivity: 'active' });
    await call1('POST', '/assistant/preferences', { text: 'Use metric units.' });
    const before = await preview(call1);
    await first.stop();

    const second = boot(); // a new process: new database handle, new app, nothing in memory
    const call2 = client(second.app, await loginOwner(second.app));
    const after = await preview(call2);
    expect(after.instruction).toBe(before.instruction);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.permanentFingerprint).toBe(before.permanentFingerprint);
    expect(after.settings.proactivity).toBe('active');
    expect(after.instruction).toContain('"Use metric units."');
    await second.stop();
  });

  it('records each permanent layer exactly once however many times the app restarts', async () => {
    for (let i = 0; i < 3; i++) {
      const run = boot();
      const call = client(run.app, i === 0 ? await registerOwner(run.app) : await loginOwner(run.app));
      const identity = assistantIdentityResponseSchema.parse(await (await call('GET', '/assistant/identity')).json());
      expect(identity.revisions).toHaveLength(3);
      await run.stop();
    }
  });
});

describe('ledger integrity', () => {
  it('refuses a permanent layer whose content changed without a version bump', async () => {
    const first = boot();
    await ensureInstructionRevisions(first.db); // a first run records the ledger
    const tampered = await first.db.run("UPDATE instruction_revisions SET content_hash = 'deadbeef' WHERE layer = 'identity'");
    expect(tampered.changes).toBe(1); // guard against a vacuous test
    await first.stop();

    const db = SqliteDatabase.open(dbPath);
    await expect(ensureInstructionRevisions(db)).rejects.toThrow(InstructionIntegrityError);
    await expect(ensureInstructionRevisions(db)).rejects.toThrow(/identity layer changed without a version bump/);
    await db.close();
  });

  it('turns health degraded when integrity fails', async () => {
    const first = boot();
    await ensureInstructionRevisions(first.db);
    const tampered = await first.db.run("UPDATE instruction_revisions SET content_hash = 'deadbeef' WHERE layer = 'constitution'");
    expect(tampered.changes).toBe(1);
    await first.stop();
    const second = boot();
    const res = await second.app.request('/api/v1/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { instructions: { status: string } } };
    expect(body.status).toBe('degraded');
    expect(body.checks.instructions.status).toBe('error');
    await second.stop();
  });

  it('accepts a deliberate, version-bumped update and keeps the history', async () => {
    const db = SqliteDatabase.open(dbPath);
    migrateSqlite(db, MIGRATIONS_DIR);
    await db.run("INSERT INTO instruction_revisions (id, layer, version, content_hash, recorded_at) VALUES ('old', 'identity', '0.9.0', 'oldhash', '2020-01-01T00:00:00.000Z')");
    await expect(ensureInstructionRevisions(db)).resolves.toBeUndefined();
    const rows = await db.all<{ version: string }>("SELECT version FROM instruction_revisions WHERE layer = 'identity' ORDER BY recorded_at");
    expect(rows.map((r) => r.version)).toEqual(['0.9.0', '1.0.0']);
    await db.close();
  });

  it('is idempotent, and retryable after the tables were missing', async () => {
    const db = SqliteDatabase.open(dbPath);
    await expect(ensureInstructionRevisions(db)).rejects.toThrow(); // not migrated yet
    migrateSqlite(db, MIGRATIONS_DIR);
    await expect(ensureInstructionRevisions(db)).resolves.toBeUndefined(); // failure was not cached
    await expect(ensureInstructionRevisions(db)).resolves.toBeUndefined();
    expect(await db.all('SELECT id FROM instruction_revisions')).toHaveLength(3);
    await db.close();
  });
});
