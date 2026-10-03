import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`works\` ADD \`submitter_credit\` text;`)
  await db.run(sql`ALTER TABLE \`works\` ADD \`submitter_url\` text;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`works\` DROP COLUMN \`submitter_url\`;`)
  await db.run(sql`ALTER TABLE \`works\` DROP COLUMN \`submitter_credit\`;`)
}
