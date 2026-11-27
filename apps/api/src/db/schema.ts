import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export type JsonObject = Record<string, unknown>;
export const workStatuses = ['pending', 'published', 'hidden', 'removed', 'deleted'] as const;
export const submissionStates = ['received', 'reviewing', 'auto_passed', 'auto_rejected', 'needs_manual', 'approved', 'rejected', 'published'] as const;
export const workStatus = pgEnum('work_status', workStatuses);
export const workKind = pgEnum('work_kind', ['submission', 'owner-picks', 'blue-fish']);
export const submissionState = pgEnum('submission_state', submissionStates);
export const submissionSource = pgEnum('submission_source', ['web', 'github-issue', 'qq', 'manual']);
export const topicStatus = pgEnum('topic_status', ['draft', 'active']);
export const creatorStatus = pgEnum('creator_status', ['queued', 'active', 'paused']);
export const videoStatus = pgEnum('video_status', ['queued', 'reviewing', 'approved', 'rejected', 'manual', 'hidden']);
export const requestType = pgEnum('request_type', ['takedown', 'attribution', 'source-correction', 'license-correction']);
export const adminRole = pgEnum('admin_role', ['owner', 'bot']);
export const auditActor = pgEnum('audit_actor', ['owner', 'hermes', 'system']);
export const notifyStatus = pgEnum('notify_status', ['pending', 'sent', 'failed']);
export const linkKind = pgEnum('link_kind', ['friend', 'project']);

const date = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = () => ({ createdAt: date('created_at').notNull().defaultNow(), updatedAt: date('updated_at').notNull().defaultNow() });
const object = (name: string) => jsonb(name).$type<JsonObject>().notNull().default({});
const strings = (name: string) => text(name).array().notNull().default(sql`ARRAY[]::text[]`);

export const workSearchText = (t: Record<'name' | 'description' | 'commentary' | 'tags' | 'i18n', AnyPgColumn>) =>
  sql`dafeiyu_search_text(${t.name}, ${t.description}, ${t.commentary}, ${t.tags}, ${t.i18n})`;

export const characters = pgTable('characters', {
  id: text('id').primaryKey(), name: text('name').notNull(), aliases: strings('aliases'), description: text('description').notNull().default(''),
  i18n: object('i18n'), portraitKey: text('portrait_key'), portraitWidth: integer('portrait_width'), portraitHeight: integer('portrait_height'),
  brandTokens: object('brand_tokens'), sortOrder: integer('sort_order').notNull().default(0), status: text('status').notNull().default('active'),
}, t => [index('characters_search_trgm_idx').using('gin', sql`dafeiyu_search_text(${t.name}, ${t.description}, '', ${t.aliases}, ${t.i18n}) gin_trgm_ops`)]);

export const categories = pgTable('categories', {
  id: text('id').primaryKey(), name: text('name').notNull(), description: text('description').notNull().default(''),
  i18n: object('i18n'), sortOrder: integer('sort_order').notNull().default(0), status: text('status').notNull().default('active'),
}, t => [check('categories_fixed_ids', sql`${t.id} IN ('meme', 'illustration', 'setting', 'comic', 'standing', 'other')`)]);

export const works = pgTable('works', {
  id: text('id').primaryKey(), slug: text('slug').notNull().unique(), name: text('name').notNull(),
  description: text('description').notNull().default(''), commentary: text('commentary').notNull().default(''),
  kind: workKind('kind').notNull().default('submission'), channel: text('channel'),
  submissionId: text('submission_id').references((): AnyPgColumn => submissions.id),
  sha256: text('sha256').notNull().unique(), primaryCharacterId: text('primary_character_id').notNull().references(() => characters.id),
  categoryId: text('category_id').notNull().references(() => categories.id), tags: strings('tags'),
  r2OriginalKey: text('r2_original_key').notNull(), r2ThumbKey: text('r2_thumb_key').notNull(), r2DisplayKey: text('r2_display_key').notNull(),
  format: text('format').notNull(), mimeType: text('mime_type').notNull(), isAnimated: boolean('is_animated').notNull().default(false),
  width: integer('width').notNull(), height: integer('height').notNull(), fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  thumbWidth: integer('thumb_width').notNull(), thumbHeight: integer('thumb_height').notNull(),
  displayWidth: integer('display_width').notNull(), displayHeight: integer('display_height').notNull(),
  submitter: object('submitter'), origin: object('origin'), license: object('license'), i18n: object('i18n'),
  status: workStatus('status').notNull().default('pending'), revision: text('revision').notNull(),
  viewCount: bigint('view_count', { mode: 'number' }).notNull().default(0), downloadCount: bigint('download_count', { mode: 'number' }).notNull().default(0),
  publishedAt: date('published_at'), ...timestamps(),
}, t => [
  index('works_status_published_slug_idx').on(t.status, t.publishedAt.desc(), t.slug.asc()),
  index('works_category_status_idx').on(t.categoryId, t.status),
  index('works_primary_character_idx').on(t.primaryCharacterId),
  index('works_tags_idx').using('gin', t.tags),
  index('works_search_trgm_idx').using('gin', sql`${workSearchText(t)} gin_trgm_ops`),
  check('works_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
]);

export const workCharacters = pgTable('work_characters', {
  workId: text('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  characterId: text('character_id').notNull().references(() => characters.id),
}, t => [primaryKey({ columns: [t.workId, t.characterId] }), index('work_characters_character_idx').on(t.characterId, t.workId)]);

export const topics = pgTable('topics', {
  id: text('id').primaryKey(), name: text('name').notNull(), summary: text('summary').notNull().default(''),
  coverWorkId: text('cover_work_id').references(() => works.id), isSerial: boolean('is_serial').notNull().default(false),
  readerConfig: object('reader_config'), author: jsonb('author').$type<JsonObject>(), i18n: object('i18n'),
  status: topicStatus('status').notNull().default('draft'), sortOrder: integer('sort_order').notNull().default(0), ...timestamps(),
}, t => [index('topics_status_serial_order_idx').on(t.status, t.isSerial, t.sortOrder)]);

export const topicWorks = pgTable('topic_works', {
  topicId: text('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  workId: text('work_id').notNull().references(() => works.id), position: integer('position').notNull().default(0), pageNumber: integer('page_number'),
}, t => [
  primaryKey({ columns: [t.topicId, t.workId] }), index('topic_works_work_idx').on(t.workId), index('topic_works_position_idx').on(t.topicId, t.position),
  uniqueIndex('topic_works_page_idx').on(t.topicId, t.pageNumber), check('topic_works_page_check', sql`${t.pageNumber} > 0`),
]);

export const submissions = pgTable('submissions', {
  id: text('id').primaryKey(), source: submissionSource('source').notNull(), sourceIds: strings('source_ids'),
  sha256: text('sha256').unique(), r2StagingKey: text('r2_staging_key').notNull(), fields: object('fields'),
  editorial: object('editorial'), review: object('review'), agentProgress: object('agent_progress'), state: submissionState('state').notNull().default('received'),
  stateHistory: jsonb('state_history').$type<JsonObject[]>().notNull().default([]), origin: object('origin'),
  workId: text('work_id').references((): AnyPgColumn => works.id), ...timestamps(),
}, t => [index('submissions_state_created_idx').on(t.state, t.createdAt), index('submissions_source_ids_idx').using('gin', t.sourceIds),
  check('submissions_require_original_digest', sql`${t.sha256} IS NOT NULL OR ${t.state} = 'published'`)]);

export const creators = pgTable('creators', {
  id: text('id').primaryKey(), uid: text('uid').notNull().unique(), homepage: text('homepage').notNull(), name: text('name').notNull().default(''),
  avatarKey: text('avatar_key'), intro: text('intro').notNull().default(''), status: creatorStatus('status').notNull().default('queued'),
  syncPage: integer('sync_page').notNull().default(1), syncLease: jsonb('sync_lease').$type<JsonObject>(),
  lastSyncedAt: date('last_synced_at'), retryAt: date('retry_at'), error: text('error'), ...timestamps(),
}, t => [index('creators_sync_idx').on(t.status, t.retryAt, t.lastSyncedAt)]);

export const videos = pgTable('videos', {
  id: text('id').primaryKey(), bvid: text('bvid').notNull().unique(), creatorId: text('creator_id').notNull().references(() => creators.id),
  title: text('title').notNull(), source: object('source'), status: videoStatus('status').notNull().default('queued'),
  review: object('review'), lease: jsonb('lease').$type<JsonObject>(), publishedAt: date('published_at'), ...timestamps(),
}, t => [index('videos_creator_status_idx').on(t.creatorId, t.status), index('videos_status_published_idx').on(t.status, t.publishedAt.desc())]);

export const takedownRequests = pgTable('takedown_requests', {
  id: text('id').primaryKey(), requestType: requestType('request_type').notNull(), workId: text('work_id').references(() => works.id),
  requester: object('requester'), status: text('status').notNull().default('received'), decisionNote: text('decision_note'),
  issueData: object('issue_data'), agentProgress: object('agent_progress'), processedAt: date('processed_at'), ...timestamps(),
}, t => [index('takedown_requests_status_idx').on(t.status, t.createdAt)]);

export const events = pgTable('events', {
  id: text('id').primaryKey(), slug: text('slug').notNull().unique(), title: text('title').notNull(), summary: text('summary').notNull().default(''),
  i18n: object('i18n'), payload: object('payload'), status: text('status').notNull().default('active'), startsAt: date('starts_at'), endsAt: date('ends_at'),
});

export const friendLinks = pgTable('friend_links', {
  id: text('id').primaryKey(), kind: linkKind('kind').notNull(), name: text('name').notNull(), url: text('url').notNull(),
  description: text('description').notNull().default(''), avatarKey: text('avatar_key'), i18n: object('i18n'),
  sortOrder: integer('sort_order').notNull().default(0), status: text('status').notNull().default('active'),
});

export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(), email: text('email').notNull().unique(), passwordHash: text('password_hash'),
  role: adminRole('role').notNull(), apiTokenHash: text('api_token_hash').unique(), lastLoginAt: date('last_login_at'),
});

export const bulkJobs = pgTable('bulk_jobs', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), payload: object('payload'), status: text('status').notNull().default('queued'),
  progress: object('progress'), result: object('result'), ...timestamps(),
}, t => [index('bulk_jobs_status_idx').on(t.status, t.createdAt)]);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(), actorType: auditActor('actor_type').notNull(), actorId: text('actor_id'),
  entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(), action: text('action').notNull(),
  diff: object('diff'), createdAt: date('created_at').notNull().defaultNow(),
}, t => [index('audit_events_entity_idx').on(t.entityType, t.entityId, t.createdAt.desc())]);

export const notifyOutbox = pgTable('notify_outbox', {
  id: uuid('id').primaryKey(), eventType: text('event_type').notNull(), payload: object('payload'), status: notifyStatus('status').notNull().default('pending'),
  messageId: text('message_id'), attempts: integer('attempts').notNull().default(0), nextRetryAt: date('next_retry_at').defaultNow(),
  createdAt: date('created_at').notNull().defaultNow(),
}, t => [index('notify_outbox_retry_idx').on(t.status, t.nextRetryAt)]);

export type WorkRow = typeof works.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type TopicRow = typeof topics.$inferSelect;
