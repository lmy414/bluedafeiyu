import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE submissions ADD COLUMN editorial text;`)
  await db.run(sql`ALTER TABLE submissions ADD COLUMN queue_version text;`)
  await db.run(sql`CREATE TABLE bulk_jobs (
    id integer PRIMARY KEY NOT NULL,
    job_id text NOT NULL, operation text NOT NULL, target text NOT NULL,
    status text NOT NULL DEFAULT 'queued', ids text NOT NULL, options text, results text,
    cursor numeric NOT NULL DEFAULT 0, requested_by_id integer NOT NULL, finished_at text,
    updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY(requested_by_id) REFERENCES users(id) ON DELETE RESTRICT
  );`)
  await db.run(sql`CREATE UNIQUE INDEX bulk_jobs_job_id_idx ON bulk_jobs(job_id);`)
  await db.run(sql`CREATE INDEX bulk_jobs_status_idx ON bulk_jobs(status);`)
  await db.run(sql`CREATE INDEX bulk_jobs_requested_by_idx ON bulk_jobs(requested_by_id);`)
  await db.run(sql`CREATE INDEX bulk_jobs_created_at_idx ON bulk_jobs(created_at);`)
  await db.run(sql`CREATE INDEX bulk_jobs_updated_at_idx ON bulk_jobs(updated_at);`)
  await db.run(sql`CREATE INDEX works_console_idx ON works(status,channel,updated_at,id);`)
  await db.run(sql`CREATE INDEX submissions_console_idx ON submissions(state,work_id,source,created_at,id);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX IF EXISTS works_console_idx;`)
  await db.run(sql`DROP INDEX IF EXISTS submissions_console_idx;`)
  await db.run(sql`DROP TABLE bulk_jobs;`)
  await db.run(sql`ALTER TABLE submissions DROP COLUMN editorial;`)
  await db.run(sql`ALTER TABLE submissions DROP COLUMN queue_version;`)
}
