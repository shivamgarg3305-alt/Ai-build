import type { Database } from '../db/types';
import { getCoreLayers } from './core';

/** Thrown when a permanent layer's content differs from what was recorded for the same version. */
export class InstructionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstructionIntegrityError';
  }
}

interface LedgerRow {
  version: string;
  content_hash: string;
}

async function verifyAndRecord(db: Database): Promise<void> {
  for (const layer of await getCoreLayers()) {
    const rows = await db.all<LedgerRow>('SELECT version, content_hash FROM instruction_revisions WHERE layer = ?', [layer.id]);
    if (rows.some((row) => row.version === layer.version && row.content_hash !== layer.hash)) {
      throw new InstructionIntegrityError(
        `The ${layer.id} layer changed without a version bump (still ${layer.version}). ` +
          `Bump its version constant, run "npm run assistant:lock -w @assistant/api", and redeploy.`,
      );
    }
    if (!rows.some((row) => row.content_hash === layer.hash)) {
      await db.run(
        'INSERT OR IGNORE INTO instruction_revisions (id, layer, version, content_hash, recorded_at) VALUES (?, ?, ?, ?, ?)',
        [crypto.randomUUID(), layer.id, layer.version, layer.hash, new Date().toISOString()],
      );
    }
  }
}

const checked = new WeakMap<Database, Promise<void>>();

/**
 * Verifies the permanent layers against the persisted ledger and records any new (deliberate) version.
 * Memoised per Database instance; a failure is not cached, so it can be retried (e.g. after migrating).
 */
export function ensureInstructionRevisions(db: Database): Promise<void> {
  let pending = checked.get(db);
  if (!pending) {
    pending = verifyAndRecord(db).catch((error: unknown) => {
      checked.delete(db);
      throw error;
    });
    checked.set(db, pending);
  }
  return pending;
}

export interface Revision {
  layer: 'identity' | 'constitution' | 'personality';
  version: string;
  sha256: string;
  recordedAt: string;
}

export async function listRevisions(db: Database): Promise<Revision[]> {
  return db.all<Revision>(
    'SELECT layer, version, content_hash AS sha256, recorded_at AS recordedAt FROM instruction_revisions ORDER BY recorded_at, layer',
  );
}
