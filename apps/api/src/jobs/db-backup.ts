import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { openR2 } from './r2.js';
import { requiredEnv, runCli } from './runtime.js';

const prefix = 'postgres/';
function command(file: string, args: string[], env = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
    child.once('error', error => reject(new Error(`无法运行 ${file}：${error.message}`)));
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${file} 失败（${code ?? signal}）`)));
  });
}

export async function backupDatabase(databaseUrl: string, r2: ReturnType<typeof openR2>, bucket = 'dafeiyu-backups', now = new Date()) {
  const connection = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('DATABASE_URL 必须是 PostgreSQL 连接地址');
  const password = connection.searchParams.get('password') || decodeURIComponent(connection.password);
  connection.password = '';
  connection.searchParams.delete('password');
  const temp = await mkdtemp(join(process.env.DAFEIYU_BACKUP_TMPDIR || tmpdir(), 'dafeiyu-pg-'));
  const sql = join(temp, 'dump.sql');
  const compressed = `${sql}.zst`;
  const key = `${prefix}${now.toISOString().replace(/:/g, '-')}.sql.zst`;
  try {
    await command('pg_dump', ['--no-password', '--no-owner', '--no-acl', '--file', sql, '--dbname', connection.href],
      { ...process.env, ...(password && { PGPASSWORD: password }) });
    await command('zstd', ['-q', '-o', compressed, sql]);
    const { size } = await stat(compressed);
    if (size <= 0) throw new Error('压缩备份为空');
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(compressed), ContentLength: size, ContentType: 'application/zstd' }));
    const cutoff = new Date(now.valueOf() - 30 * 86_400_000);
    let token: string | undefined;
    let pruned = 0;
    do {
      const page = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      const old = (page.Contents || []).filter(item => item.Key && /^postgres\/\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sql\.zst$/.test(item.Key) && item.LastModified && item.LastModified < cutoff);
      if (old.length) {
        const outcome = await r2.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: old.map(item => ({ Key: item.Key })), Quiet: true } }));
        if (outcome.Errors?.length) throw new Error(`R2 旧备份清理失败 ${outcome.Errors.length} 个`);
        pruned += old.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return { key, bytes: size, pruned };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

runCli(import.meta.url, async () => {
  const r2 = openR2();
  try { return await backupDatabase(requiredEnv('DATABASE_URL'), r2, process.env.R2_BACKUPS_BUCKET); }
  finally { r2.destroy(); }
});
