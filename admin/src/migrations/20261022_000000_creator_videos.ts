import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-sqlite'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE creators (
    id integer PRIMARY KEY NOT NULL, uid text NOT NULL, homepage text NOT NULL, name text NOT NULL,
    intro text NOT NULL, status text NOT NULL DEFAULT 'queued', sync_page numeric DEFAULT 1,
    sync_lease text, last_synced_at text, retry_at text, error text, needs_publish integer DEFAULT 0,
    updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`)
  await db.run(sql`CREATE UNIQUE INDEX creators_uid_idx ON creators(uid);`)
  await db.run(sql`CREATE INDEX creators_status_idx ON creators(status);`)
  await db.run(sql`CREATE INDEX creators_created_at_idx ON creators(created_at);`)
  await db.run(sql`CREATE INDEX creators_updated_at_idx ON creators(updated_at);`)
  await db.run(sql`CREATE TABLE videos (
    id integer PRIMARY KEY NOT NULL, bvid text NOT NULL, creator_id integer NOT NULL,
    title text NOT NULL, source text NOT NULL, status text NOT NULL DEFAULT 'queued',
    review text, lease text, needs_publish integer DEFAULT 0,
    updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY(creator_id) REFERENCES creators(id) ON DELETE RESTRICT
  );`)
  await db.run(sql`CREATE UNIQUE INDEX videos_bvid_idx ON videos(bvid);`)
  await db.run(sql`CREATE INDEX videos_creator_idx ON videos(creator_id);`)
  await db.run(sql`CREATE INDEX videos_status_idx ON videos(status);`)
  await db.run(sql`CREATE INDEX videos_created_at_idx ON videos(created_at);`)
  await db.run(sql`CREATE INDEX videos_updated_at_idx ON videos(updated_at);`)
}
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE videos;`)
  await db.run(sql`DROP TABLE creators;`)
}
