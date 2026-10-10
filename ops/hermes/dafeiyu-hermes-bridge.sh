#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  agent-tool|review|pull|publish|maintenance|maintenance-plan|maintenance-report) action="$1" ;;
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

if [[ "$action" == agent-tool ]]; then
  set -a
  . /etc/dafeiyu/admin.env
  set +a
  exec /usr/sbin/runuser -u dafeiyu --preserve-environment -- /usr/bin/node ops/hermes/tool.mjs
fi

if [[ "$action" == review ]]; then
  echo 'Direct review-cycle is retired; run the Hermes editorial Agent task.' >&2
  exit 65
fi

/usr/sbin/runuser -u dafeiyu -- /usr/bin/node server/cli.mjs pull-issues --state open --max-pages 5
