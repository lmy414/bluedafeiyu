#!/usr/bin/env bash
# Run as root on the host, from a GitHub-updated repository. Agent job stays disabled.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR=/srv/apps/hermes-studio/data
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${HOME_DIR}/backups/editorial-host-${STAMP}"
install -d -m 700 "$BACKUP"
if [[ -f /usr/local/sbin/dafeiyu-hermes-bridge ]]; then
  cp -a /usr/local/sbin/dafeiyu-hermes-bridge "$BACKUP/bridge.sh"
fi
if [[ -d "$HOME_DIR/plugins/dafeiyu-editorial" ]]; then
  cp -a "$HOME_DIR/plugins/dafeiyu-editorial" "$BACKUP/plugin"
fi
install -m 755 "$ROOT/ops/hermes/dafeiyu-hermes-bridge.sh" /usr/local/sbin/dafeiyu-hermes-bridge
install -d -m 755 "$HOME_DIR/plugins/dafeiyu-editorial" "$HOME_DIR/skills/dafeiyu-editorial"
install -m 644 "$ROOT/ops/hermes/editorial-plugin/__init__.py" "$ROOT/ops/hermes/editorial-plugin/plugin.yaml" "$HOME_DIR/plugins/dafeiyu-editorial/"
install -m 644 "$ROOT/ops/hermes/editorial-skill/SKILL.md" "$HOME_DIR/skills/dafeiyu-editorial/SKILL.md"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
printf '%s\n' 'hermes ALL=(root) NOPASSWD: /usr/local/sbin/dafeiyu-hermes-bridge agent-tool' > "$TMP"
visudo -cf "$TMP"
install -m 440 "$TMP" /etc/sudoers.d/dafeiyu-hermes-editorial
# Configuration is read from stdin inside the running container; no secrets copied.
docker exec -i hermes-webui /opt/hermes/.venv/bin/python - < "$ROOT/ops/hermes/configure-editorial.py"
printf 'Installed editorial tools. Existing review Agent remains disabled. Backup: %s\n' "$BACKUP"
