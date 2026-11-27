import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const app = createApp({ db, config });
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, ({ address, port }) => {
  console.log(`dafeiyu API listening at http://${address}:${port}`);
});

function stop() {
  server.close(() => { void close().catch(error => { console.error('Database close failed', error); process.exitCode = 1; }); });
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
