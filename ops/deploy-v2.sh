#!/usr/bin/env bash
set -euo pipefail

root=/srv/new-business/dafeiyu-v2
branch=${DEPLOY_BRANCH:-v2}
service_user=dafeiyu-v2
env_dir=/etc/dafeiyu-v2

die() { printf '%s\n' "$*" >&2; exit 1; }

[[ $EUID == 0 ]] || die 'Run the deployment as root to install units and restart services.'
[[ -d "$root/.git" ]] || die "Provision a Git checkout at $root first."
[[ -r "$env_dir/api.env" && -r "$env_dir/web.env" ]] || die "Provision api.env and web.env in $env_dir first."
pnpm=$(command -v pnpm) || die 'pnpm is required on the system PATH.'
[[ -x /usr/bin/node ]] || die 'The systemd units require /usr/bin/node.'

exec 9>/run/lock/dafeiyu-v2-deploy.lock
flock -n 9 || die 'Another v2 deployment is running.'

as_service_user() {
  runuser -u "$service_user" -- "$@"
}

with_env() {
  local env_file=$1 workdir=$2
  shift 2
  systemd-run --quiet --pipe --wait --collect \
    --uid="$service_user" --gid="$service_user" --working-directory="$workdir" \
    --property="EnvironmentFile=$env_file" --property=UMask=0027 \
    --setenv="PATH=$(dirname "$pnpm"):/usr/local/bin:/usr/bin:/bin" "$@"
}

cd "$root"
current_branch=$(as_service_user git symbolic-ref --quiet --short HEAD) || die "Check out '$branch' before deploying. HEAD is detached or unreadable."
[[ "$current_branch" == "$branch" ]] || die "Expected branch '$branch' but found '$current_branch'."
as_service_user git diff --quiet || die 'The v2 checkout contains unstaged changes.'
as_service_user git diff --cached --quiet || die 'The v2 checkout contains staged changes.'
as_service_user git pull --ff-only origin "$branch"
as_service_user "$pnpm" install --frozen-lockfile

for package in shared api admin; do
  as_service_user "$pnpm" --filter "@dafeiyu/$package" run build
done
with_env "$env_dir/web.env" "$root" "$pnpm" --filter @dafeiyu/web run build
with_env "$env_dir/api.env" "$root/apps/api" "$pnpm" run db:migrate

for unit in "$root"/ops/systemd/dafeiyu-v2-*.{service,timer}; do
  install -m 0644 "$unit" /etc/systemd/system/
done
systemctl daemon-reload

wait_for_200() {
  local url=$1 unit=$2 status
  for ((attempt = 1; attempt <= 30; attempt++)); do
    status=$(curl --silent --noproxy '*' --connect-timeout 2 --max-time 3 --output /dev/null --write-out '%{http_code}' "$url") || status=000
    if [[ $status == 200 ]]; then
      printf 'HTTP 200 %s\n' "$url"
      return
    fi
    sleep 1
  done
  die "Health check failed for $url (HTTP $status). Inspect journalctl -u $unit."
}

systemctl restart dafeiyu-v2-api.service
wait_for_200 http://127.0.0.1:4331/api/v1/health dafeiyu-v2-api.service
systemctl restart dafeiyu-v2-web.service
wait_for_200 http://127.0.0.1:4330/ dafeiyu-v2-web.service
