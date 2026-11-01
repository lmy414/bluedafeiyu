import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

// Additive migration: keep the existing topics table and all its relationships.
// The application stores an empty summary as '' for the legacy NOT NULL column.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE topics ADD COLUMN translation_state text DEFAULT 'none';`)
  await db.run(sql`ALTER TABLE topics ADD COLUMN translation_source_hash text;`)
  await db.run(sql`ALTER TABLE topics ADD COLUMN translation_revision numeric DEFAULT 0;`)
  await db.run(sql`ALTER TABLE topics ADD COLUMN translation_updated_at text;`)
  await db.run(sql`ALTER TABLE topics ADD COLUMN translation_error text;`)
  await db.run(sql`ALTER TABLE topics ADD COLUMN translation_job_id text;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE topics DROP COLUMN translation_job_id;`)
  await db.run(sql`ALTER TABLE topics DROP COLUMN translation_error;`)
  await db.run(sql`ALTER TABLE topics DROP COLUMN translation_updated_at;`)
  await db.run(sql`ALTER TABLE topics DROP COLUMN translation_revision;`)
  await db.run(sql`ALTER TABLE topics DROP COLUMN translation_source_hash;`)
  await db.run(sql`ALTER TABLE topics DROP COLUMN translation_state;`)
}
