import { z } from 'zod';

const optional = z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional());
const origin = z.string().url().transform(value => new URL(value)).refine(
  url => ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
).transform(url => url.origin);
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4331),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().url().refine(value => /^postgres(?:ql)?:\/\//.test(value)),
  R2_ACCOUNT_ID: z.string().regex(/^[a-f\d]{32}$/i),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_MEDIA_BUCKET: z.string().min(1).default('dafeiyu-media'),
  R2_STAGING_BUCKET: z.string().min(1).default('dafeiyu-staging'),
  R2_BACKUPS_BUCKET: z.string().min(1).default('dafeiyu-backups'),
  R2_PUBLIC_BASE_URL: origin.default('https://img.xn--pssy23gqgbz2d718b.com'),
  CF_ZONE_ID: optional,
  CF_API_TOKEN: optional,
  TURNSTILE_SECRET_KEY: optional,
  SESSION_SECRET: z.string().min(32),
  HERMES_REVIEW_TOKEN: optional,
  ADMIN_WORKER_TOKEN: optional,
  QQ_INBOUND_TOKEN: optional,
  FEISHU_NOTIFY_APP_ID: optional,
  FEISHU_NOTIFY_APP_SECRET: optional,
  FEISHU_NOTIFY_CHAT_ID: optional,
  SITE_PUBLIC_URL: origin.default('https://xn--pssy23gqgbz2d718b.com'),
  ADMIN_DIST_DIR: optional,
  ALLOWED_ORIGINS: z.string().optional().transform(value => value?.split(',').map(item => item.trim()).filter(Boolean) ?? []).pipe(z.array(origin)),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

export type Config = z.output<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment variables: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  return result.data;
}
