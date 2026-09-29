import fs from 'node:fs'
import path from 'node:path'

import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // 旧数据迁移到“只存预览”：先断开投稿对旧原图/大图的引用，再删除媒体记录和实际文件。
  const { rows: legacyMedia } = await db.run(sql`SELECT \`filename\`, \`sizes_thumbnail_filename\` FROM \`media\` WHERE \`media_role\` IN ('original', 'large');`)
  await db.run(sql`UPDATE \`submissions\` SET \`media_id\` = NULL WHERE \`media_id\` IN (SELECT \`id\` FROM \`media\` WHERE \`media_role\` IN ('original', 'large'));`)
  await db.run(sql`DELETE FROM \`media\` WHERE \`media_role\` IN ('original', 'large');`)
  const mediaRoot = path.resolve(process.env.MEDIA_DIR || path.resolve(process.cwd(), 'media'))
  for (const row of legacyMedia || []) {
    for (const value of [row?.filename, row?.sizes_thumbnail_filename]) {
      const filename = String(value || '')
      if (!filename || path.basename(filename) !== filename) continue
      const target = path.resolve(mediaRoot, filename)
      if (target !== mediaRoot && target.startsWith(`${mediaRoot}${path.sep}`)) fs.rmSync(target, { force: true })
    }
  }
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_works\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`work_id\` text NOT NULL,
  	\`slug\` text,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`commentary\` text,
  	\`kind\` text DEFAULT 'submission' NOT NULL,
  	\`channel\` text DEFAULT 'manual' NOT NULL,
  	\`submission_id\` text,
  	\`sha256\` text,
  	\`character_id\` integer NOT NULL,
  	\`preview_id\` integer,
  	\`legacy_paths_path\` text,
  	\`legacy_paths_thumbnail_path\` text,
  	\`legacy_paths_full_path\` text,
  	\`legacy_paths_external_original_url\` text,
  	\`format\` text,
  	\`mime_type\` text,
  	\`is_animated\` integer DEFAULT false,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`file_size\` numeric,
  	\`submitter_name\` text,
  	\`submitter_github\` text,
  	\`origin\` text,
  	\`license\` text,
  	\`status\` text DEFAULT 'pending' NOT NULL,
  	\`needs_publish\` integer DEFAULT true,
  	\`change_action\` text,
  	\`published_at\` text,
  	\`last_published_at\` text,
  	\`last_publish_run_id\` integer,
  	\`review\` text,
  	\`legacy_source\` text,
  	\`legacy_order\` numeric,
  	\`legacy_data\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`character_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`preview_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`last_publish_run_id\`) REFERENCES \`publish_runs\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_works\`("id", "work_id", "slug", "name", "description", "commentary", "kind", "channel", "submission_id", "sha256", "character_id", "preview_id", "legacy_paths_path", "legacy_paths_thumbnail_path", "legacy_paths_full_path", "legacy_paths_external_original_url", "format", "mime_type", "is_animated", "width", "height", "file_size", "submitter_name", "submitter_github", "origin", "license", "status", "needs_publish", "change_action", "published_at", "last_published_at", "last_publish_run_id", "review", "legacy_source", "legacy_order", "legacy_data", "updated_at", "created_at") SELECT "id", "work_id", "slug", "name", "description", "commentary", "kind", "channel", "submission_id", "sha256", "character_id", "preview_id", "legacy_paths_path", "legacy_paths_thumbnail_path", "legacy_paths_full_path", "legacy_paths_external_original_url", "format", "mime_type", "is_animated", "width", "height", "file_size", "submitter_name", "submitter_github", "origin", "license", "status", "needs_publish", "change_action", "published_at", "last_published_at", "last_publish_run_id", "review", "legacy_source", "legacy_order", "legacy_data", "updated_at", "created_at" FROM \`works\`;`)
  await db.run(sql`DROP TABLE \`works\`;`)
  await db.run(sql`ALTER TABLE \`__new_works\` RENAME TO \`works\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE UNIQUE INDEX \`works_work_id_idx\` ON \`works\` (\`work_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`works_slug_idx\` ON \`works\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`works_submission_id_idx\` ON \`works\` (\`submission_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`works_sha256_idx\` ON \`works\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`works_character_idx\` ON \`works\` (\`character_id\`);`)
  await db.run(sql`CREATE INDEX \`works_preview_idx\` ON \`works\` (\`preview_id\`);`)
  await db.run(sql`CREATE INDEX \`works_last_publish_run_idx\` ON \`works\` (\`last_publish_run_id\`);`)
  await db.run(sql`CREATE INDEX \`works_updated_at_idx\` ON \`works\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`works_created_at_idx\` ON \`works\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_media\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`alt\` text NOT NULL,
  	\`sha256\` text,
  	\`media_role\` text DEFAULT 'preview' NOT NULL,
  	\`storage_kind\` text DEFAULT 'payload-private' NOT NULL,
  	\`external_url\` text,
  	\`source_path\` text,
  	\`is_animated\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric,
  	\`sizes_thumbnail_url\` text,
  	\`sizes_thumbnail_width\` numeric,
  	\`sizes_thumbnail_height\` numeric,
  	\`sizes_thumbnail_mime_type\` text,
  	\`sizes_thumbnail_filesize\` numeric,
  	\`sizes_thumbnail_filename\` text
  );
  `)
  await db.run(sql`INSERT INTO \`__new_media\`("id", "alt", "sha256", "media_role", "storage_kind", "external_url", "source_path", "is_animated", "updated_at", "created_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y", "sizes_thumbnail_url", "sizes_thumbnail_width", "sizes_thumbnail_height", "sizes_thumbnail_mime_type", "sizes_thumbnail_filesize", "sizes_thumbnail_filename") SELECT "id", "alt", "sha256", "media_role", "storage_kind", "external_url", "source_path", "is_animated", "updated_at", "created_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y", "sizes_thumbnail_url", "sizes_thumbnail_width", "sizes_thumbnail_height", "sizes_thumbnail_mime_type", "sizes_thumbnail_filesize", "sizes_thumbnail_filename" FROM \`media\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`ALTER TABLE \`__new_media\` RENAME TO \`media\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_sha256_idx\` ON \`media\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE INDEX \`media_sizes_thumbnail_sizes_thumbnail_filename_idx\` ON \`media\` (\`sizes_thumbnail_filename\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_media\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`alt\` text NOT NULL,
  	\`sha256\` text,
  	\`media_role\` text DEFAULT 'original' NOT NULL,
  	\`storage_kind\` text DEFAULT 'payload-private' NOT NULL,
  	\`external_url\` text,
  	\`source_path\` text,
  	\`is_animated\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric,
  	\`sizes_thumbnail_url\` text,
  	\`sizes_thumbnail_width\` numeric,
  	\`sizes_thumbnail_height\` numeric,
  	\`sizes_thumbnail_mime_type\` text,
  	\`sizes_thumbnail_filesize\` numeric,
  	\`sizes_thumbnail_filename\` text
  );
  `)
  await db.run(sql`INSERT INTO \`__new_media\`("id", "alt", "sha256", "media_role", "storage_kind", "external_url", "source_path", "is_animated", "updated_at", "created_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y", "sizes_thumbnail_url", "sizes_thumbnail_width", "sizes_thumbnail_height", "sizes_thumbnail_mime_type", "sizes_thumbnail_filesize", "sizes_thumbnail_filename") SELECT "id", "alt", "sha256", "media_role", "storage_kind", "external_url", "source_path", "is_animated", "updated_at", "created_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y", "sizes_thumbnail_url", "sizes_thumbnail_width", "sizes_thumbnail_height", "sizes_thumbnail_mime_type", "sizes_thumbnail_filesize", "sizes_thumbnail_filename" FROM \`media\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`ALTER TABLE \`__new_media\` RENAME TO \`media\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_sha256_idx\` ON \`media\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE INDEX \`media_sizes_thumbnail_sizes_thumbnail_filename_idx\` ON \`media\` (\`sizes_thumbnail_filename\`);`)
  await db.run(sql`ALTER TABLE \`works\` ADD \`original_id\` integer REFERENCES media(id);`)
  await db.run(sql`ALTER TABLE \`works\` ADD \`large_id\` integer REFERENCES media(id);`)
  await db.run(sql`CREATE INDEX \`works_original_idx\` ON \`works\` (\`original_id\`);`)
  await db.run(sql`CREATE INDEX \`works_large_idx\` ON \`works\` (\`large_id\`);`)
}
