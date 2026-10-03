import * as migration_20260929_033658_initial from './20260929_033658_initial';
import * as migration_20260929_052303_remove_original_large from './20260929_052303_remove_original_large';
import * as migration_20261002_000000_topic_author from './20261002_000000_topic_author';
import * as migration_20261004_000000_submitter_credit from './20261004_000000_submitter_credit';

export const migrations = [
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
];
