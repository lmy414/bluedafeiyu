#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  review|pull|publish|maintenance|maintenance-plan|maintenance-report) action="$1" ;;
  *) echo 'invalid action' >&2; exit 64 ;;
esac
if [[ "$#" -ne 1 ]]; then
  echo 'one action required' >&2
  exit 64
fi

case "$action" in
  maintenance) exec /usr/local/sbin/dafeiyu-maintenance apply ;;
  maintenance-plan) exec /usr/local/sbin/dafeiyu-maintenance plan ;;
  maintenance-report) exec /usr/local/sbin/dafeiyu-maintenance report ;;
esac

sync_admin() {
  (
    set -a
    . /etc/dafeiyu/admin-bot.env
    set +a
    export ADMIN_API_URL=http://127.0.0.1:3100
    exec /usr/bin/flock "$@" /run/lock/dafeiyu-admin-sync.lock \
      /usr/sbin/runuser -u dafeiyu-admin --preserve-environment -- \
      /usr/bin/node /srv/apps/dafeiyu-admin/src/ops/admin/hermes-publish.mjs --sync-only
  )
}

if [[ "$action" == publish ]]; then
  sync_admin -w 600
  set -a
  . /etc/dafeiyu/admin-bot.env
  set +a
  export ADMIN_API_URL=http://127.0.0.1:3100
  exec /usr/sbin/runuser -u dafeiyu-admin --preserve-environment -- \
    /usr/bin/node /srv/apps/dafeiyu-admin/src/ops/admin/hermes-publish.mjs
fi

set -a
. /etc/dafeiyu-submission.env
. /etc/dafeiyu/hermes.env
set +a
cd /srv/apps/dafeiyu/source

if [[ "$action" == review ]]; then
  /usr/sbin/runuser -u dafeiyu -- /usr/bin/node ops/hermes/cli.mjs review-cycle --live --limit 20 --json
  if ! sync_admin -n >&2; then
    echo 'admin sync skipped: lock busy or sync failed' >&2
  fi
  (
    set -a
    . /etc/dafeiyu/admin-publish.env
    set +a
    /usr/bin/node /srv/apps/dafeiyu/source/ops/issue-reconcile.mjs
  ) >&2 || echo 'issue reconcile failed' >&2
  exit 0
fi

/usr/sbin/runuser -u dafeiyu -- /usr/bin/node server/cli.mjs pull-issues --state open --max-pages 5
