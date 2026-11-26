import type { Database } from '../db/types';

export interface AuditEntry {
  userId: string | null;
  event: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: Database, entry: AuditEntry, now: Date): Promise<void> {
  await db.run(
    'INSERT INTO audit_logs (id, user_id, event, entity_type, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      crypto.randomUUID(),
      entry.userId,
      entry.event,
      entry.entityType ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      now.toISOString(),
    ],
  );
}
