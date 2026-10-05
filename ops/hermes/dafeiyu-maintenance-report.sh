#!/usr/bin/env bash
set -euo pipefail
if ! output="$(ssh -o BatchMode=yes -o ConnectTimeout=10 codex-host sudo -n /usr/local/sbin/dafeiyu-hermes-bridge maintenance-report 2>&1)"; then
  printf '服务器定期维护｜报告失败\n服务器：aliyun-hk\n%s\n' "$output"
  exit 1
fi
printf '%s\n' "$output"
