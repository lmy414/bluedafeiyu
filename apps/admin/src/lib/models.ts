export type JsonObject = Record<string, unknown>;
export type Row = { id: string };
export type Option = { id: string; name: string };
export type Translation = WorkTranslation & { summary?: string };
export type I18n = Partial<Record<'en' | 'ja', Translation>>;
export type Page<T> = { items: T[]; total?: number; page?: number; pageSize?: number; hasMore?: boolean };

export type WorkFields = {
  name?: string;
  description?: string | null;
  commentary?: string | null;
  kind?: string;
  channel?: string;
  primaryCharacterId?: string | null;
  characterIds?: string[];
  categoryId?: string | null;
  tags?: string[];
  submitter?: JsonObject | null;
  origin?: JsonObject | null;
  license?: JsonObject | null;
  i18n?: I18n | null;
};

export type Work = Row & WorkFields & {
  slug: string;
  status: string;
  revision?: string;
  sha256?: string;
  submissionId?: string | null;
  image?: { originalUrl?: string; thumbnailUrl?: string; displayUrl?: string } | null;
  thumbnailUrl?: string;
  thumbUrl?: string;
  originalUrl?: string;
  r2OriginalKey?: string | null;
  r2ThumbKey?: string;
  width?: number;
  height?: number;
  format?: string;
  mimeType?: string;
  isAnimated?: boolean;
  fileSize?: number;
  thumbWidth?: number;
  thumbHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  viewCount?: number;
  downloadCount?: number;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Submission = Row & {
  state: string;
  source: string;
  sourceIds?: string[];
  fields?: SubmissionFields;
  editorial?: SubmissionFields;
  origin?: JsonObject;
  review?: JsonObject;
  agentProgress?: JsonObject;
  originalUrl?: string;
  previewUrl?: string;
  workId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SubmissionFields = WorkFields & {
  title?: string;
  character?: string;
  characterId?: string;
  categoryIds?: string[];
  credit?: string;
  creditName?: string;
  creditUrl?: string;
};

export type Taxon = Row & Option & {
  description?: string | null;
  aliases?: string[];
  i18n?: I18n | null;
  portraitKey?: string | null;
  portraitUrl?: string | null;
  brandTokens?: JsonObject | null;
  sortOrder?: number;
  status?: string;
};

export type TopicWork = { workId: string; name?: string; position?: number; pageNumber?: number | null };
export type Topic = Row & Option & {
  summary?: string | null;
  status?: string;
  sortOrder?: number;
  coverWorkId?: string | null;
  isSerial?: boolean;
  readerConfig?: (JsonObject & { totalPages?: number; credits?: string }) | null;
  author?: JsonObject | null;
  i18n?: I18n | null;
  works?: TopicWork[];
};

export type EventPopupConfig = {
  enabled?: boolean;
  version?: string;
  badge?: string;
  headline?: string;
  description?: string;
  highlights?: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
};

export type AdminEvent = Row & {
  slug: string;
  title: string;
  summary: string;
  status: 'active' | 'archived' | 'hidden';
  startsAt?: string | null;
  endsAt?: string | null;
  i18n?: JsonObject;
  payload?: JsonObject & {
    body?: string;
    url?: string;
    exhibition?: string;
    repository?: string;
    cover?: { src?: string; width?: number; height?: number };
    popup?: EventPopupConfig;
  };
};

export type Creator = Row & {
  uid: string;
  name?: string;
  homepage?: string;
  status: string;
  syncPage?: number;
  syncLease?: JsonObject;
  lastSyncedAt?: string;
  retryAt?: string;
  error?: unknown;
};

export type Video = Row & {
  bvid: string;
  creatorId: string;
  title: string;
  status: string;
  review?: JsonObject;
  createdAt?: string;
};

export type RightsRequest = Row & {
  requestType: string;
  status: string;
  workId?: string;
  requester?: JsonObject;
  decisionNote?: string;
  issueData?: JsonObject;
  agentProgress?: JsonObject;
  createdAt?: string;
};

export type Bot = Row & { email: string; lastLoginAt?: string; status?: string; hasKey?: boolean };
export type BulkJob = Row & { kind: string; status: string; progress?: JsonObject; result?: unknown; updatedAt?: string };
export type AuditEvent = Row & { actorType: string; actorId?: string; entityType: string; entityId: string; action: string; diff?: unknown; createdAt?: string };
export type Notification = Row & { eventType: string; status: string; attempts?: number; messageId?: string; error?: string; createdAt?: string; nextRetryAt?: string };
export type Dashboard = {
  autoPublishedToday: number;
  autoPublishedThisWeek: number;
  pendingReview: number;
  needsManual: number;
  recentAutoPublished: Work[];
  health: { db: string | boolean; r2: string | boolean };
  recentNotifications: Notification[];
};

export const workStatuses = { pending: '待上线', published: '已上线', hidden: '已隐藏', removed: '已移除', deleted: '已彻底删除' };
export const submissionStates = {
  received: '待审', reviewing: '审核中', auto_passed: '自动通过', auto_rejected: '自动拒绝',
  needs_manual: '待人工', approved: '人工批准', rejected: '已拒绝', published: '已上线',
};
export const sources = { web: '网页', 'github-issue': 'GitHub', qq: 'QQ', manual: '人工', owner: '站长', 'blue-fish': '首批档案' };
export const workKinds = { submission: '投稿', 'owner-picks': '站长推荐', 'blue-fish': '首批档案' };
export const taxonomyStatuses = { active: '启用', hidden: '已隐藏' };
export const topicStatuses = { draft: '草稿', active: '已上线' };
export const creatorStatuses = { queued: '排队中', active: '已启用', paused: '已暂停' };
export const videoStatuses = { queued: '待审', reviewing: '审核中', approved: '已上线', rejected: '已拒绝', manual: '待人工', hidden: '已下架' };
export const rightTypes = { takedown: '下架', attribution: '署名更正', 'source-correction': '来源更正', 'license-correction': '授权更正' };
export const rightStatuses = { received: '待处理', investigating: '调查中', needs_manual: '待人工', approved: '已批准', rejected: '已拒绝', completed: '已完成' };
export const jobStatuses = { queued: '排队中', pending: '待处理', running: '执行中', completed: '已完成', succeeded: '已成功', failed: '失败', cancelled: '已取消' };
export const notificationStatuses = { pending: '待发送', sent: '已发送', failed: '发送失败' };

export function options(labels: Record<string, string>): Option[] {
  return Object.entries(labels).map(([id, name]) => ({ id, name }));
}

export function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

export function editorialProgress(progress?: JsonObject | null) {
  if (!progress) return undefined;
  const { token, completedToken, imageToken, ...details } = progress;
  return details;
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function publicMedia(key?: string | null): string | undefined {
  return key ? `https://img.xn--pssy23gqgbz2d718b.com/${key.split('/').map(encodeURIComponent).join('/')}` : undefined;
}

export function thumbnail(work: Work): string | undefined {
  if (['removed', 'deleted'].includes(work.status)) return undefined;
  return safeUrl(work.image?.thumbnailUrl || work.thumbnailUrl || work.thumbUrl) || publicMedia(work.r2ThumbKey);
}

const dateTime = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Hong_Kong',
});

export function time(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date);
}
import type { WorkTranslation } from '@dafeiyu/shared';
