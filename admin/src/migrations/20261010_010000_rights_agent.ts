import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-sqlite'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE takedown_requests ADD COLUMN issue_data text;`)
  await db.run(sql`ALTER TABLE takedown_requests ADD COLUMN agent_progress text;`)
}
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE takedown_requests DROP COLUMN agent_progress;`)
  await db.run(sql`ALTER TABLE takedown_requests DROP COLUMN issue_data;`)
}
