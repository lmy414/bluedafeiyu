import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE works_rels ADD COLUMN characters_id integer REFERENCES characters(id) ON DELETE CASCADE;`)
  await db.run(sql`CREATE INDEX works_rels_characters_id_idx ON works_rels (characters_id);`)
  await db.run(sql`INSERT INTO works_rels ("order", parent_id, path, characters_id) SELECT 1, id, 'characters', character_id FROM works WHERE character_id IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DELETE FROM works_rels WHERE path='characters';`)
  await db.run(sql`DROP INDEX works_rels_characters_id_idx;`)
  await db.run(sql`ALTER TABLE works_rels DROP COLUMN characters_id;`)
}
