import type { Database } from '../db/types';
import { assembleInstructions, type AssembledInstructions } from './assemble';
import { ensureInstructionRevisions } from './ledger';
import { getPersonalitySettings, listPreferences } from './store';

export interface InstructionExtras {
  sessionContext?: readonly string[];
  taskInstructions?: readonly string[];
}

/**
 * Loads a user's persisted configuration (personality settings, preferences), verifies the permanent
 * layers against the ledger, and assembles the full instruction. This is the single entry point the
 * conversation layer will call before every model request.
 */
export async function loadAssembly(db: Database, userId: string, extras: InstructionExtras = {}): Promise<AssembledInstructions> {
  await ensureInstructionRevisions(db);
  const [{ settings }, preferences] = await Promise.all([getPersonalitySettings(db, userId), listPreferences(db, userId)]);
  return assembleInstructions({ settings, preferences: preferences.map((p) => p.text), ...extras });
}
