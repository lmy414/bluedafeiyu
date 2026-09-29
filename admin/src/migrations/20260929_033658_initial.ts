import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`role\` text DEFAULT 'owner' NOT NULL,
  	\`display_name\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`enable_a_p_i_key\` integer,
  	\`api_key\` text,
  	\`api_key_index\` text,
  	\`email\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`reset_password_requested_at\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`media\` (
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
  await db.run(sql`CREATE UNIQUE INDEX \`media_sha256_idx\` ON \`media\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE INDEX \`media_sizes_thumbnail_sizes_thumbnail_filename_idx\` ON \`media\` (\`sizes_thumbnail_filename\`);`)
  await db.run(sql`CREATE TABLE \`characters_aliases\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`value\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`characters_aliases_order_idx\` ON \`characters_aliases\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`characters_aliases_parent_id_idx\` ON \`characters_aliases\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`characters\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`character_id\` text NOT NULL,
  	\`name\` text NOT NULL,
  	\`status\` text DEFAULT 'active' NOT NULL,
  	\`in_submission_form\` integer DEFAULT true,
  	\`legacy_order\` numeric,
  	\`legacy_data\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`characters_character_id_idx\` ON \`characters\` (\`character_id\`);`)
  await db.run(sql`CREATE INDEX \`characters_updated_at_idx\` ON \`characters\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`characters_created_at_idx\` ON \`characters\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`categories\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`category_id\` text NOT NULL,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`status\` text DEFAULT 'active' NOT NULL,
  	\`legacy_order\` numeric,
  	\`legacy_data\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`categories_category_id_idx\` ON \`categories\` (\`category_id\`);`)
  await db.run(sql`CREATE INDEX \`categories_updated_at_idx\` ON \`categories\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`categories_created_at_idx\` ON \`categories\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`submissions_source_ids\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`value\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`submissions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`submissions_source_ids_order_idx\` ON \`submissions_source_ids\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`submissions_source_ids_parent_id_idx\` ON \`submissions_source_ids\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`submissions\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text NOT NULL,
  	\`submission_id\` text NOT NULL,
  	\`source\` text NOT NULL,
  	\`sha256\` text,
  	\`media_id\` integer,
  	\`fields\` text,
  	\`review\` text,
  	\`state\` text DEFAULT 'received' NOT NULL,
  	\`state_history\` text,
  	\`origin\` text,
  	\`work_id\` integer,
  	\`synced_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`work_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`submissions_submission_id_idx\` ON \`submissions\` (\`submission_id\`);`)
  await db.run(sql`CREATE INDEX \`submissions_sha256_idx\` ON \`submissions\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`submissions_media_idx\` ON \`submissions\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`submissions_work_idx\` ON \`submissions\` (\`work_id\`);`)
  await db.run(sql`CREATE INDEX \`submissions_updated_at_idx\` ON \`submissions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`submissions_created_at_idx\` ON \`submissions\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`works_tags\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`value\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`works_tags_order_idx\` ON \`works_tags\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`works_tags_parent_id_idx\` ON \`works_tags\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`works\` (
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
  	\`original_id\` integer,
  	\`preview_id\` integer,
  	\`large_id\` integer,
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
  	FOREIGN KEY (\`original_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`preview_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`large_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`last_publish_run_id\`) REFERENCES \`publish_runs\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`works_work_id_idx\` ON \`works\` (\`work_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`works_slug_idx\` ON \`works\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`works_submission_id_idx\` ON \`works\` (\`submission_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`works_sha256_idx\` ON \`works\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`works_character_idx\` ON \`works\` (\`character_id\`);`)
  await db.run(sql`CREATE INDEX \`works_original_idx\` ON \`works\` (\`original_id\`);`)
  await db.run(sql`CREATE INDEX \`works_preview_idx\` ON \`works\` (\`preview_id\`);`)
  await db.run(sql`CREATE INDEX \`works_large_idx\` ON \`works\` (\`large_id\`);`)
  await db.run(sql`CREATE INDEX \`works_last_publish_run_idx\` ON \`works\` (\`last_publish_run_id\`);`)
  await db.run(sql`CREATE INDEX \`works_updated_at_idx\` ON \`works\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`works_created_at_idx\` ON \`works\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`works_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`categories_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`categories_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`works_rels_order_idx\` ON \`works_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`works_rels_parent_idx\` ON \`works_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`works_rels_path_idx\` ON \`works_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`works_rels_categories_id_idx\` ON \`works_rels\` (\`categories_id\`);`)
  await db.run(sql`CREATE TABLE \`topics\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`topic_id\` text NOT NULL,
  	\`name\` text NOT NULL,
  	\`summary\` text NOT NULL,
  	\`name_en\` text,
  	\`summary_en\` text,
  	\`name_ja\` text,
  	\`summary_ja\` text,
  	\`cover_id\` integer,
  	\`status\` text DEFAULT 'draft' NOT NULL,
  	\`order\` numeric DEFAULT 0 NOT NULL,
  	\`needs_publish\` integer DEFAULT true,
  	\`last_published_at\` text,
  	\`last_publish_run_id\` integer,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`cover_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`last_publish_run_id\`) REFERENCES \`publish_runs\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`topics_topic_id_idx\` ON \`topics\` (\`topic_id\`);`)
  await db.run(sql`CREATE INDEX \`topics_cover_idx\` ON \`topics\` (\`cover_id\`);`)
  await db.run(sql`CREATE INDEX \`topics_last_publish_run_idx\` ON \`topics\` (\`last_publish_run_id\`);`)
  await db.run(sql`CREATE INDEX \`topics_updated_at_idx\` ON \`topics\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`topics_created_at_idx\` ON \`topics\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`topics_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`works_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`topics\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`works_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`topics_rels_order_idx\` ON \`topics_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`topics_rels_parent_idx\` ON \`topics_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`topics_rels_path_idx\` ON \`topics_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`topics_rels_works_id_idx\` ON \`topics_rels\` (\`works_id\`);`)
  await db.run(sql`CREATE TABLE \`takedown_requests\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`request_id\` text NOT NULL,
  	\`request_type\` text NOT NULL,
  	\`work_id\` integer,
  	\`requester_name\` text,
  	\`requester_contact\` text,
  	\`requester_proof\` text,
  	\`status\` text DEFAULT 'received' NOT NULL,
  	\`decision_note\` text,
  	\`processed_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`work_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`takedown_requests_request_id_idx\` ON \`takedown_requests\` (\`request_id\`);`)
  await db.run(sql`CREATE INDEX \`takedown_requests_work_idx\` ON \`takedown_requests\` (\`work_id\`);`)
  await db.run(sql`CREATE INDEX \`takedown_requests_updated_at_idx\` ON \`takedown_requests\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`takedown_requests_created_at_idx\` ON \`takedown_requests\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`publish_runs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`run_id\` text NOT NULL,
  	\`trigger\` text DEFAULT 'manual' NOT NULL,
  	\`mode\` text DEFAULT 'publish' NOT NULL,
  	\`status\` text DEFAULT 'queued' NOT NULL,
  	\`requested_at\` text,
  	\`requested_by_id\` integer,
  	\`planned_changes\` text,
  	\`summary\` text,
  	\`step\` text,
  	\`commits\` text,
  	\`release_path\` text,
  	\`health_check\` text,
  	\`results\` text,
  	\`log\` text,
  	\`error\` text,
  	\`started_at\` text,
  	\`finished_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`requested_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`publish_runs_run_id_idx\` ON \`publish_runs\` (\`run_id\`);`)
  await db.run(sql`CREATE INDEX \`publish_runs_requested_by_idx\` ON \`publish_runs\` (\`requested_by_id\`);`)
  await db.run(sql`CREATE INDEX \`publish_runs_updated_at_idx\` ON \`publish_runs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`publish_runs_created_at_idx\` ON \`publish_runs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`publish_runs_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`works_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`publish_runs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`works_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`publish_runs_rels_order_idx\` ON \`publish_runs_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`publish_runs_rels_parent_idx\` ON \`publish_runs_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`publish_runs_rels_path_idx\` ON \`publish_runs_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`publish_runs_rels_works_id_idx\` ON \`publish_runs_rels\` (\`works_id\`);`)
  await db.run(sql`CREATE TABLE \`audit_events\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`actor_type\` text NOT NULL,
  	\`actor_id\` integer,
  	\`actor_name\` text NOT NULL,
  	\`action\` text NOT NULL,
  	\`target_type\` text NOT NULL,
  	\`target_id\` text NOT NULL,
  	\`before\` text,
  	\`after\` text,
  	\`request_id\` text,
  	\`ip\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`actor_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`audit_events_actor_idx\` ON \`audit_events\` (\`actor_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_updated_at_idx\` ON \`audit_events\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_created_at_idx\` ON \`audit_events\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`legacy_snapshots\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`text\` text NOT NULL,
  	\`eol\` text DEFAULT 'crlf' NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`legacy_snapshots_key_idx\` ON \`legacy_snapshots\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`legacy_snapshots_updated_at_idx\` ON \`legacy_snapshots\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`legacy_snapshots_created_at_idx\` ON \`legacy_snapshots\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`global_slug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	\`characters_id\` integer,
  	\`categories_id\` integer,
  	\`submissions_id\` integer,
  	\`works_id\` integer,
  	\`topics_id\` integer,
  	\`takedown_requests_id\` integer,
  	\`publish_runs_id\` integer,
  	\`audit_events_id\` integer,
  	\`legacy_snapshots_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`characters_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`categories_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`submissions_id\`) REFERENCES \`submissions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`works_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`topics_id\`) REFERENCES \`topics\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`takedown_requests_id\`) REFERENCES \`takedown_requests\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`publish_runs_id\`) REFERENCES \`publish_runs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`audit_events_id\`) REFERENCES \`audit_events\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`legacy_snapshots_id\`) REFERENCES \`legacy_snapshots\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_characters_id_idx\` ON \`payload_locked_documents_rels\` (\`characters_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_categories_id_idx\` ON \`payload_locked_documents_rels\` (\`categories_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_submissions_id_idx\` ON \`payload_locked_documents_rels\` (\`submissions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_works_id_idx\` ON \`payload_locked_documents_rels\` (\`works_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_topics_id_idx\` ON \`payload_locked_documents_rels\` (\`topics_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_takedown_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`takedown_requests_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_publish_runs_id_idx\` ON \`payload_locked_documents_rels\` (\`publish_runs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_audit_events_id_idx\` ON \`payload_locked_documents_rels\` (\`audit_events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_legacy_snapshots_id_idx\` ON \`payload_locked_documents_rels\` (\`legacy_snapshots_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`value\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`batch\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`DROP TABLE \`characters_aliases\`;`)
  await db.run(sql`DROP TABLE \`characters\`;`)
  await db.run(sql`DROP TABLE \`categories\`;`)
  await db.run(sql`DROP TABLE \`submissions_source_ids\`;`)
  await db.run(sql`DROP TABLE \`submissions\`;`)
  await db.run(sql`DROP TABLE \`works_tags\`;`)
  await db.run(sql`DROP TABLE \`works\`;`)
  await db.run(sql`DROP TABLE \`works_rels\`;`)
  await db.run(sql`DROP TABLE \`topics\`;`)
  await db.run(sql`DROP TABLE \`topics_rels\`;`)
  await db.run(sql`DROP TABLE \`takedown_requests\`;`)
  await db.run(sql`DROP TABLE \`publish_runs\`;`)
  await db.run(sql`DROP TABLE \`publish_runs_rels\`;`)
  await db.run(sql`DROP TABLE \`audit_events\`;`)
  await db.run(sql`DROP TABLE \`legacy_snapshots\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
}
