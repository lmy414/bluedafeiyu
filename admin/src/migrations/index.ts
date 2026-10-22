import * as migration_20260929_033658_initial from './20260929_033658_initial';
import * as migration_20260929_052303_remove_original_large from './20260929_052303_remove_original_large';
import * as migration_20261002_000000_topic_author from './20261002_000000_topic_author';
import * as migration_20261004_000000_submitter_credit from './20261004_000000_submitter_credit';

import * as migration_20261009_000000_bulk_jobs from './20261009_000000_bulk_jobs';
import * as migration_20261010_000000_agent_progress from './20261010_000000_agent_progress';
import * as migration_20261010_010000_rights_agent from './20261010_010000_rights_agent';

import * as migration_20261011_000000_work_characters from './20261011_000000_work_characters';
import * as migration_20261022_000000_creator_videos from './20261022_000000_creator_videos';

export const migrations = [
  // Existing migrations keep their order; the new migration is appended below.
  // Additive migration; existing editorial data and queue state stay unchanged.
  {
    up: migration_20260929_033658_initial.up,
    down: migration_20260929_033658_initial.down,
    name: '20260929_033658_initial',
  },
  {
    up: migration_20260929_052303_remove_original_large.up,
    down: migration_20260929_052303_remove_original_large.down,
    name: '20260929_052303_remove_original_large'
  },
  {
    up: migration_20261002_000000_topic_author.up,
    down: migration_20261002_000000_topic_author.down,
    name: '20261002_000000_topic_author'
  },
  {
    up: migration_20261004_000000_submitter_credit.up,
    down: migration_20261004_000000_submitter_credit.down,
    name: '20261004_000000_submitter_credit',
  },
  {
    up: migration_20261009_000000_bulk_jobs.up,
    down: migration_20261009_000000_bulk_jobs.down,
    name: '20261009_000000_bulk_jobs',
  },
  {
    up: migration_20261010_000000_agent_progress.up,
    down: migration_20261010_000000_agent_progress.down,
    name: '20261010_000000_agent_progress',
  },
  { up: migration_20261010_010000_rights_agent.up, down: migration_20261010_010000_rights_agent.down, name: '20261010_010000_rights_agent' },
  { up: migration_20261011_000000_work_characters.up, down: migration_20261011_000000_work_characters.down, name: '20261011_000000_work_characters' },
  { up: migration_20261022_000000_creator_videos.up, down: migration_20261022_000000_creator_videos.down, name: '20261022_000000_creator_videos' },
];
