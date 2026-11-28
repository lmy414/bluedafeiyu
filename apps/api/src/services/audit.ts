import type { Database, DbTransaction } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

export type AuditEntry = Pick<typeof auditEvents.$inferInsert, 'actorType' | 'actorId' | 'entityType' | 'entityId' | 'action' | 'diff'>;

export async function writeAudit(db: Database | DbTransaction, entry: AuditEntry): Promise<void> {
  await db.insert(auditEvents).values(entry);
}
