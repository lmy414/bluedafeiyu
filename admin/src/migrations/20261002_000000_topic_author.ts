import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`topics_author_channels\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`platform\` text NOT NULL,
    \`label\` text,
    \`url\` text NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`topics\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`topics_author_channels_order_idx\` ON \`topics_author_channels\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`topics_author_channels_parent_id_idx\` ON \`topics_author_channels\` (\`_parent_id\`);`)
  await db.run(sql`ALTER TABLE \`topics\` ADD \`author_name\` text;`)
  await db.run(sql`ALTER TABLE \`topics\` ADD \`author_url\` text;`)
  await db.run(sql`ALTER TABLE \`topics\` ADD \`author_bio\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`topics\` DROP COLUMN \`author_bio\`;`)
  await db.run(sql`ALTER TABLE \`topics\` DROP COLUMN \`author_url\`;`)
  await db.run(sql`ALTER TABLE \`topics\` DROP COLUMN \`author_name\`;`)
  await db.run(sql`DROP TABLE \`topics_author_channels\`;`)
}
