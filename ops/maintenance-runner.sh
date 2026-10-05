#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then echo 'one action required' >&2; exit 64; fi
case "$1" in
  report) exec /usr/bin/node /usr/local/lib/dafeiyu-maintenance/maintenance.mjs --report ;;
  plan) mode=() ;;
  apply) mode=(--apply) ;;
  *) echo 'invalid action' >&2; exit 64 ;;
esac
exec 7>/run/lock/dafeiyu-maintenance.lock
/usr/bin/flock -w 120 7
exec 9>/srv/www/dafeiyu/.deploy.lock
/usr/bin/flock -w 120 9
exec 8>/srv/apps/dafeiyu-admin/.admin-deploy.lock
/usr/bin/flock -w 120 8
set -a
. /etc/dafeiyu-submission.env
set +a
exec /usr/bin/node /usr/local/lib/dafeiyu-maintenance/maintenance.mjs "${mode[@]}"
