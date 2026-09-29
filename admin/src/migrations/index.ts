import * as migration_20260929_033658_initial from './20260929_033658_initial';
import * as migration_20260929_052303_remove_original_large from './20260929_052303_remove_original_large';

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
];
