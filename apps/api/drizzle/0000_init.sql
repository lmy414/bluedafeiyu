CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE FUNCTION dafeiyu_search_text(title text, description text, commentary text, tags text[], i18n jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT concat_ws(' ', title, description, commentary, array_to_string(tags, ' '), i18n::text)
$$;--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('owner', 'bot');--> statement-breakpoint
CREATE TYPE "public"."audit_actor" AS ENUM('owner', 'hermes', 'system');--> statement-breakpoint
CREATE TYPE "public"."creator_status" AS ENUM('queued', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."link_kind" AS ENUM('friend', 'project');--> statement-breakpoint
CREATE TYPE "public"."notify_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('takedown', 'attribution', 'source-correction', 'license-correction');--> statement-breakpoint
CREATE TYPE "public"."submission_source" AS ENUM('web', 'github-issue', 'qq', 'manual');--> statement-breakpoint
CREATE TYPE "public"."submission_state" AS ENUM('received', 'reviewing', 'auto_passed', 'auto_rejected', 'needs_manual', 'approved', 'rejected', 'published');--> statement-breakpoint
CREATE TYPE "public"."topic_status" AS ENUM('draft', 'active');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('queued', 'reviewing', 'approved', 'rejected', 'manual', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."work_kind" AS ENUM('submission', 'owner-picks', 'blue-fish');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('pending', 'published', 'hidden', 'removed', 'deleted');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" "admin_role" NOT NULL,
	"api_token_hash" text,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_users_api_token_hash_unique" UNIQUE("api_token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "audit_actor" NOT NULL,
	"actor_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "categories_fixed_ids" CHECK ("categories"."id" IN ('meme', 'illustration', 'setting', 'comic', 'standing', 'other'))
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"portrait_key" text,
	"portrait_width" integer,
	"portrait_height" integer,
	"brand_tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"homepage" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar_key" text,
	"intro" text DEFAULT '' NOT NULL,
	"status" "creator_status" DEFAULT 'queued' NOT NULL,
	"sync_page" integer DEFAULT 1 NOT NULL,
	"sync_lease" jsonb,
	"last_synced_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creators_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "friend_links" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "link_kind" NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"avatar_key" text,
	"i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notify_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notify_status" DEFAULT 'pending' NOT NULL,
	"message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "submission_source" NOT NULL,
	"source_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"sha256" text NOT NULL,
	"r2_staging_key" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"editorial" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "submission_state" DEFAULT 'received' NOT NULL,
	"state_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"work_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "takedown_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"work_id" text,
	"requester" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"decision_note" text,
	"issue_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_works" (
	"topic_id" text NOT NULL,
	"work_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"page_number" integer,
	CONSTRAINT "topic_works_topic_id_work_id_pk" PRIMARY KEY("topic_id","work_id"),
	CONSTRAINT "topic_works_page_check" CHECK ("topic_works"."page_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cover_work_id" text,
	"is_serial" boolean DEFAULT false NOT NULL,
	"reader_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"author" jsonb,
	"i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "topic_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"bvid" text NOT NULL,
	"creator_id" text NOT NULL,
	"title" text NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "video_status" DEFAULT 'queued' NOT NULL,
	"review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lease" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_bvid_unique" UNIQUE("bvid")
);
--> statement-breakpoint
CREATE TABLE "work_characters" (
	"work_id" text NOT NULL,
	"character_id" text NOT NULL,
	CONSTRAINT "work_characters_work_id_character_id_pk" PRIMARY KEY("work_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"commentary" text DEFAULT '' NOT NULL,
	"kind" "work_kind" DEFAULT 'submission' NOT NULL,
	"channel" text,
	"submission_id" text,
	"sha256" text NOT NULL,
	"primary_character_id" text NOT NULL,
	"category_id" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"r2_original_key" text NOT NULL,
	"r2_thumb_key" text NOT NULL,
	"r2_display_key" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"is_animated" boolean DEFAULT false NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size" bigint NOT NULL,
	"thumb_width" integer NOT NULL,
	"thumb_height" integer NOT NULL,
	"display_width" integer NOT NULL,
	"display_height" integer NOT NULL,
	"submitter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"license" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "work_status" DEFAULT 'pending' NOT NULL,
	"revision" text NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"download_count" bigint DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "works_slug_unique" UNIQUE("slug"),
	CONSTRAINT "works_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "works_sha256_check" CHECK ("works"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_works" ADD CONSTRAINT "topic_works_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_works" ADD CONSTRAINT "topic_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_cover_work_id_works_id_fk" FOREIGN KEY ("cover_work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_characters" ADD CONSTRAINT "work_characters_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_characters" ADD CONSTRAINT "work_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_primary_character_id_characters_id_fk" FOREIGN KEY ("primary_character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bulk_jobs_status_idx" ON "bulk_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "characters_search_trgm_idx" ON "characters" USING gin (dafeiyu_search_text("name", "description", '', "aliases", "i18n") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "creators_sync_idx" ON "creators" USING btree ("status","retry_at","last_synced_at");--> statement-breakpoint
CREATE INDEX "notify_outbox_retry_idx" ON "notify_outbox" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "submissions_state_created_idx" ON "submissions" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "submissions_source_ids_idx" ON "submissions" USING gin ("source_ids");--> statement-breakpoint
CREATE INDEX "takedown_requests_status_idx" ON "takedown_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "topic_works_work_idx" ON "topic_works" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "topic_works_position_idx" ON "topic_works" USING btree ("topic_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_works_page_idx" ON "topic_works" USING btree ("topic_id","page_number");--> statement-breakpoint
CREATE INDEX "topics_status_serial_order_idx" ON "topics" USING btree ("status","is_serial","sort_order");--> statement-breakpoint
CREATE INDEX "videos_creator_status_idx" ON "videos" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "videos_status_published_idx" ON "videos" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_characters_character_idx" ON "work_characters" USING btree ("character_id","work_id");--> statement-breakpoint
CREATE INDEX "works_status_published_slug_idx" ON "works" USING btree ("status","published_at" DESC NULLS LAST,"slug");--> statement-breakpoint
CREATE INDEX "works_category_status_idx" ON "works" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "works_primary_character_idx" ON "works" USING btree ("primary_character_id");--> statement-breakpoint
CREATE INDEX "works_tags_idx" ON "works" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "works_search_trgm_idx" ON "works" USING gin (dafeiyu_search_text("name", "description", "commentary", "tags", "i18n") gin_trgm_ops);
