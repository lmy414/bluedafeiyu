import { existsSync } from 'node:fs';
import { createDb } from './db/client.js';
import { initializeOwner } from './routes/admin/auth.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('需要设置 DATABASE_URL、ADMIN_EMAIL 和 ADMIN_PASSWORD');
const { db, close } = createDb(DATABASE_URL);
try {
  const owner = await initializeOwner(db, ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log(`已初始化管理员 ${owner.email}`);
} finally { await close(); }
