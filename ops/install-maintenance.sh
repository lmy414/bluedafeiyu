#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ || $(id -u) -ne 0 ]]; then
  echo 'root and one verified commit required' >&2
  exit 64
fi
revision="$1"
repository=/srv/apps/dafeiyu/source
stage=$(mktemp -d /tmp/dafeiyu-maintenance-install.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
get_source() {
  git -c safe.directory="$repository" -C "$repository" show "$revision:$1" > "$2"
}
get_source ops/maintenance.mjs "$stage/maintenance.mjs"
get_source ops/maintenance-runner.sh "$stage/runner.sh"
get_source ops/hermes/dafeiyu-hermes-bridge.sh "$stage/bridge.sh"
get_source ops/hermes/dafeiyu-maintenance-report.sh "$stage/report.sh"
get_source ops/hermes/maintenance-skill/SKILL.md "$stage/SKILL.md"
get_source ops/systemd/dafeiyu-prune-originals.service "$stage/dafeiyu-prune-originals.service"
/usr/bin/node --check "$stage/maintenance.mjs"
/usr/bin/bash -n "$stage/runner.sh" "$stage/bridge.sh" "$stage/report.sh"
printf '%s\n' 'hermes ALL=(root) NOPASSWD: /usr/local/sbin/dafeiyu-hermes-bridge maintenance, /usr/local/sbin/dafeiyu-hermes-bridge maintenance-plan, /usr/local/sbin/dafeiyu-hermes-bridge maintenance-report' > "$stage/sudoers"
/usr/sbin/visudo -cf "$stage/sudoers"
backup="/var/lib/dafeiyu-maintenance/install-backups/$(date +%Y%m%d-%H%M%S)"
install -d -m 0700 "$backup"
cp -p /usr/local/sbin/dafeiyu-hermes-bridge "$backup/bridge.sh"
cp -p /etc/systemd/system/dafeiyu-prune-originals.service "$backup/dafeiyu-prune-originals.service"
install -D -o root -g root -m 0644 "$stage/maintenance.mjs" /usr/local/lib/dafeiyu-maintenance/maintenance.mjs
install -D -o root -g root -m 0755 "$stage/runner.sh" /usr/local/sbin/dafeiyu-maintenance
install -D -o root -g root -m 0755 "$stage/bridge.sh" /usr/local/sbin/dafeiyu-hermes-bridge
install -D -o root -g root -m 0440 "$stage/sudoers" /etc/sudoers.d/dafeiyu-hermes-maintenance
install -D -o root -g root -m 0644 "$stage/dafeiyu-prune-originals.service" /etc/systemd/system/dafeiyu-prune-originals.service
install -D -o root -g root -m 0755 "$stage/report.sh" /srv/apps/hermes-studio/data/scripts/dafeiyu-maintenance-report.sh
install -D -o root -g root -m 0644 "$stage/SKILL.md" /srv/apps/hermes-studio/data/skills/devops/dafeiyu-server-maintenance/SKILL.md
/usr/sbin/visudo -cf /etc/sudoers
/usr/bin/systemd-analyze verify /etc/systemd/system/dafeiyu-prune-originals.service
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable --now dafeiyu-prune-originals.timer
printf 'maintenance installed: %s\nbackup: %s\n' "$revision" "$backup"
