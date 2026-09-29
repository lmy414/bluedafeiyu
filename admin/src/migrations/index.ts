import * as migration_20260929_033658_initial from './20260929_033658_initial';

export const migrations = [
  {
    up: migration_20260929_033658_initial.up,
    down: migration_20260929_033658_initial.down,
    name: '20260929_033658_initial'
  },
];
