import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, connect_timeout: 10 });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

export type Database = ReturnType<typeof createDb>['db'];
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
