import { asc, eq } from 'drizzle-orm';
import type { Config } from '../../config.js';
import type { Database, DbTransaction } from '../../db/client.js';
import { categories, characters, workCharacters } from '../../db/schema.js';
import type { WorkRow } from '../../db/schema.js';
import type { createCloudflare } from '../../services/cloudflare.js';
import type { createFeishu } from '../../services/feishu.js';
import type { createPublisher } from '../../services/publish.js';
import type { R2Service } from '../../services/r2.js';
import { imageFormat } from './protocol.js';
import { sourceHash } from './editorial.js';

export interface HermesContext {
  db: Database;
  config: Config;
  services: {
    publish: Pick<ReturnType<typeof createPublisher>, 'autoPublishSubmission' | 'removeWork' | 'purgeWorkCaches'>;
    r2: Pick<R2Service, 'getObjectBuffer' | 'putObject'>;
    feishu: Pick<ReturnType<typeof createFeishu>, 'enqueue' | 'sendPending'>;
    cloudflare: ReturnType<typeof createCloudflare>;
    authenticateAdmin?: (req: Request) => Promise<{ id: string; role: 'owner' | 'bot' } | null>;
  };
}

export async function getImage(ctx: HermesContext, bucket: string, key: string) {
  if (!key) return null;
  try {
    const bytes = await ctx.services.r2.getObjectBuffer(bucket, key, 30 * 1024 * 1024);
    const type = imageFormat(bytes);
    return type && { bytes, mime: type.mime };
  } catch (error) {
    const e = error as { status?: number; $metadata?: { httpStatusCode?: number } };
    if ((e.status ?? e.$metadata?.httpStatusCode) === 404) return null;
    throw error;
  }
}

export function purgeTopic(ctx: HermesContext, id: string) {
  return ctx.services.cloudflare.purgePrefixes(['', '/zh-hant', '/en', '/ja'].flatMap(lang => [`${lang}/topics/${id}`, `${lang}/topics.html`, `${lang}/serials.html`]).concat('/open-api/v1'));
}

export async function vocabulary(db: Database | DbTransaction) {
  const roles = await db.select({ id: characters.id, name: characters.name }).from(characters)
    .where(eq(characters.status, 'active')).orderBy(asc(characters.sortOrder), asc(characters.id));
  const types = await db.select({ id: categories.id, name: categories.name }).from(categories)
    .where(eq(categories.status, 'active')).orderBy(asc(categories.sortOrder), asc(categories.id));
  return { characters: roles, categories: types, characterIds: new Set(roles.map(row => row.id)), categoryIds: new Set(types.map(row => row.id)) };
}

export async function workDraft(db: Database | DbTransaction, row: WorkRow) {
  const linked = await db.select({ id: workCharacters.characterId }).from(workCharacters)
    .where(eq(workCharacters.workId, row.id)).orderBy(asc(workCharacters.characterId));
  const draft = {
    name: row.name, description: row.description, commentary: row.commentary, tags: row.tags,
    characterId: row.primaryCharacterId, characterIds: [...new Set([row.primaryCharacterId, ...linked.map(link => link.id)])],
    categoryIds: [row.categoryId], origin: row.origin, license: row.license, submitter: row.submitter, i18n: row.i18n,
  };
  // The old source hash also encodes the historic role ordering. The join table
  // represents a set, so recover the old ordering for existing translations.
  const digest = row.i18n.sourceHash;
  function recover(prefix: string[], remaining: string[]): string[] | undefined {
    if (!remaining.length) return sourceHash({ ...draft, characterIds: prefix }) === digest ? prefix : undefined;
    for (const id of remaining) {
      const match = recover([...prefix, id], remaining.filter(other => other !== id));
      if (match) return match;
    }
  }
  if (typeof digest === 'string' && draft.characterIds.length > 1 && draft.characterIds.length <= 6 && sourceHash(draft) !== digest)
    draft.characterIds = recover([], draft.characterIds) || draft.characterIds;
  return draft;
}
