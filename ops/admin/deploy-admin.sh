#!/usr/bin/env bash
#
# ops/admin/deploy-admin.sh —— 后台 standalone 发布包部署脚本
#
# 构建已经搬到 GitHub Actions。服务器只做：下载 Release 附件、校验 sha256、解压、
# 备份 SQLite、以 dafeiyu-admin 用户执行 Payload 迁移、原子切换 app 软链、重启服务。
# 服务器不执行 npm ci / next build，避免把 2 核 3.4G 机器拖到失联。
#
# 可配置项（环境变量优先于 ADMIN_ENV_FILE）：
#   ADMIN_REPO          GitHub 仓库，默认 lmy414/bluedafeiyu
#   ADMIN_RELEASE_TAG   Release tag；留空时选择最新的 admin-<sha> prerelease
#   ADMIN_DEPLOY_ROOT   部署根目录，默认 /srv/apps/dafeiyu-admin
#   ADMIN_RELEASES_DIR  release 目录，默认 ${ADMIN_DEPLOY_ROOT}/releases
#   ADMIN_APP_LINK      app 软链，默认 ${ADMIN_DEPLOY_ROOT}/app
#   ADMIN_SERVICE       systemd 服务名，默认 dafeiyu-admin.service
#   ADMIN_SERVICE_USER  迁移/服务用户，默认 dafeiyu-admin
#   ADMIN_HEALTH_URL    后台本机地址，默认 http://127.0.0.1:3100
# 真实域名、IP、数据库地址、令牌和密钥只放 /etc/dafeiyu/admin.env，不写进仓库。

set -euo pipefail

log() { printf '[admin-deploy] %s %s\n' "$(date -Is)" "$*"; }
die() { printf '[admin-deploy] %s 错误：%s\n' "$(date -Is)" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 配置加载

ADMIN_ENV_FILE="${ADMIN_ENV_FILE:-/etc/dafeiyu/admin.env}"
CONFIG_VARS=(
  ADMIN_REPO
  ADMIN_RELEASE_TAG
  ADMIN_BRANCH
  ADMIN_DEPLOY_ROOT
  ADMIN_RELEASES_DIR
  ADMIN_APP_LINK
  ADMIN_SERVICE
  ADMIN_SERVICE_USER
  ADMIN_SERVICE_GROUP
  ADMIN_HEALTH_URL
  ADMIN_DATA_DIR
  ADMIN_MEDIA_DIR
  ADMIN_RUN_DIR
  ADMIN_BACKUP_DIR
  DATABASE_URL
  PAYLOAD_SECRET
)

declare -A __preset=()
for name in "${CONFIG_VARS[@]}"; do
  if [ -n "${!name:-}" ]; then
    __preset[$name]="${!name}"
  fi
done

if [ -f "${ADMIN_ENV_FILE}" ]; then
  log "加载后台环境文件：${ADMIN_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${ADMIN_ENV_FILE}"
  set +a
else
  log "未找到后台环境文件：${ADMIN_ENV_FILE}，继续使用当前环境变量"
fi

for name in "${!__preset[@]}"; do
  printf -v "${name}" '%s' "${__preset[$name]}"
done

ADMIN_REPO="${ADMIN_REPO:-lmy414/bluedafeiyu}"
ADMIN_RELEASE_TAG="${ADMIN_RELEASE_TAG:-}"
ADMIN_BRANCH="${ADMIN_BRANCH:-feat/admin-console}"
ADMIN_DEPLOY_ROOT="${ADMIN_DEPLOY_ROOT:-/srv/apps/dafeiyu-admin}"
ADMIN_RELEASES_DIR="${ADMIN_RELEASES_DIR:-${ADMIN_DEPLOY_ROOT}/releases}"
ADMIN_APP_LINK="${ADMIN_APP_LINK:-${ADMIN_DEPLOY_ROOT}/app}"
ADMIN_SERVICE="${ADMIN_SERVICE:-dafeiyu-admin.service}"
ADMIN_SERVICE_USER="${ADMIN_SERVICE_USER:-dafeiyu-admin}"
ADMIN_SERVICE_GROUP="${ADMIN_SERVICE_GROUP:-dafeiyu-admin}"
ADMIN_HEALTH_URL="${ADMIN_HEALTH_URL:-http://127.0.0.1:3100}"
ADMIN_DATA_DIR="${ADMIN_DATA_DIR:-${ADMIN_DEPLOY_ROOT}/data}"
ADMIN_MEDIA_DIR="${ADMIN_MEDIA_DIR:-${ADMIN_DEPLOY_ROOT}/media}"
ADMIN_RUN_DIR="${ADMIN_RUN_DIR:-${ADMIN_DEPLOY_ROOT}/run}"
ADMIN_BACKUP_DIR="${ADMIN_BACKUP_DIR:-${ADMIN_DATA_DIR}/backups}"
LOG_DIR="${ADMIN_DEPLOY_ROOT}/logs"
HEALTH_URL="${ADMIN_HEALTH_URL%/}/admin/login"
FIXED_RELEASE_TAG="admin-latest-${ADMIN_BRANCH//\//-}"

for command_name in flock gh tar sha256sum sqlite3 curl runuser systemctl node; do
  command -v "${command_name}" >/dev/null 2>&1 || die "缺少命令：${command_name}"
done

if ! id "${ADMIN_SERVICE_USER}" >/dev/null 2>&1; then
  die "用户不存在：${ADMIN_SERVICE_USER}"
fi
if ! getent group "${ADMIN_SERVICE_GROUP}" >/dev/null 2>&1; then
  die "用户组不存在：${ADMIN_SERVICE_GROUP}"
fi

# ---------------------------------------------------------------- 解析 Release

if [ -z "${ADMIN_RELEASE_TAG}" ]; then
  log "未指定 ADMIN_RELEASE_TAG，查询最新的 admin-<sha> prerelease"
  ADMIN_RELEASE_TAG="$(
    gh release list \
      --repo "${ADMIN_REPO}" \
      --limit 100 \
      --exclude-drafts \
      --json tagName,isPrerelease,publishedAt \
      --jq '[.[] | select(.isPrerelease and (.tagName | test("^admin-[0-9a-fA-F]{7,40}$")))] | sort_by(.publishedAt) | reverse | .[0].tagName // empty'
  )"
fi

if [ -z "${ADMIN_RELEASE_TAG}" ]; then
  log "没有 admin-<sha> prerelease，尝试固定 tag：${FIXED_RELEASE_TAG}"
  ADMIN_RELEASE_TAG="$(
    gh release list \
      --repo "${ADMIN_REPO}" \
      --limit 100 \
      --exclude-drafts \
      --json tagName,isPrerelease,publishedAt \
      --jq "[.[] | select(.isPrerelease and .tagName == \"${FIXED_RELEASE_TAG}\")] | sort_by(.publishedAt) | reverse | .[0].tagName // empty"
  )"
fi

[ -n "${ADMIN_RELEASE_TAG}" ] || die "找不到后台 Release；请在 workflow 完成后重试或显式设置 ADMIN_RELEASE_TAG"

RELEASE_TAG_SAFE="${ADMIN_RELEASE_TAG//\//-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_NAME="${RELEASE_TAG_SAFE}-${STAMP}-$$"
RELEASE_DIR="${ADMIN_RELEASES_DIR}/${RELEASE_NAME}"
STAGING_DIR="${ADMIN_RELEASES_DIR}/.${RELEASE_NAME}.staging.$$"

mkdir -p "${ADMIN_RELEASES_DIR}" "${LOG_DIR}" "${ADMIN_DATA_DIR}" "${ADMIN_MEDIA_DIR}" "${ADMIN_RUN_DIR}" "${ADMIN_BACKUP_DIR}"
install -d -m 750 -o "${ADMIN_SERVICE_USER}" -g "${ADMIN_SERVICE_GROUP}" \
  "${ADMIN_DATA_DIR}" "${ADMIN_MEDIA_DIR}" "${ADMIN_RUN_DIR}" "${ADMIN_BACKUP_DIR}"

TMP_DIR="$(mktemp -d "${ADMIN_DEPLOY_ROOT}/.admin-download.XXXXXX")"

cleanup() {
  rm -rf "${TMP_DIR}" "${STAGING_DIR}"
}
trap cleanup EXIT

exec 9>"${ADMIN_DEPLOY_ROOT}/.admin-deploy.lock"
if ! flock -n 9; then
  die "已有后台发布在运行：${ADMIN_DEPLOY_ROOT}/.admin-deploy.lock"
fi

log "下载 Release：${ADMIN_REPO}@${ADMIN_RELEASE_TAG}"
if ! gh release download "${ADMIN_RELEASE_TAG}" --repo "${ADMIN_REPO}" --dir "${TMP_DIR}" --clobber; then
  die "gh release download 失败：${ADMIN_RELEASE_TAG}"
fi

ARCHIVE_COUNT="$(find "${TMP_DIR}" -maxdepth 1 -type f -name '*.tar.gz' | wc -l | tr -d ' ')"
CHECKSUM_COUNT="$(find "${TMP_DIR}" -maxdepth 1 -type f -name '*.tar.gz.sha256' | wc -l | tr -d ' ')"
[ "${ARCHIVE_COUNT}" = "1" ] || die "Release 必须且只能有一个 .tar.gz 附件，实际：${ARCHIVE_COUNT}"
[ "${CHECKSUM_COUNT}" = "1" ] || die "Release 必须且只能有一个 .tar.gz.sha256 附件，实际：${CHECKSUM_COUNT}"

ARCHIVE_PATH="$(find "${TMP_DIR}" -maxdepth 1 -type f -name '*.tar.gz' | head -n 1)"
CHECKSUM_PATH="$(find "${TMP_DIR}" -maxdepth 1 -type f -name '*.tar.gz.sha256' | head -n 1)"
ARCHIVE_NAME="$(basename "${ARCHIVE_PATH}")"
CHECKSUM_NAME="$(basename "${CHECKSUM_PATH}")"

log "校验 sha256：${ARCHIVE_NAME}"
if ! (cd "${TMP_DIR}" && sha256sum -c "${CHECKSUM_NAME}"); then
  die "sha256 校验失败"
fi

mkdir -p "${STAGING_DIR}"
log "解压到临时目录：${STAGING_DIR}"
if ! tar -xzf "${ARCHIVE_PATH}" -C "${STAGING_DIR}"; then
  die "tar 解压失败"
fi

for required in \
  "${STAGING_DIR}/server.js" \
  "${STAGING_DIR}/migrate.mjs" \
  "${STAGING_DIR}/node_modules/payload/package.json" \
  "${STAGING_DIR}/node_modules/@payloadcms/db-sqlite/package.json" \
  "${STAGING_DIR}/node_modules/@libsql/client/package.json" \
  "${STAGING_DIR}/node_modules/libsql/package.json" \
  "${STAGING_DIR}/node_modules/sharp/package.json"; do
  [ -e "${required}" ] || die "发布包缺少必需文件：${required}"
done
[ -d "${STAGING_DIR}/.next/static" ] || die "发布包缺少 .next/static"
[ ! -e "${STAGING_DIR}/.env" ] || die "发布包不应包含 .env"
[ ! -e "${STAGING_DIR}/admin.db" ] || die "发布包不应包含 admin.db"

if ! mv "${STAGING_DIR}" "${RELEASE_DIR}"; then
  die "无法把临时 release 移到 ${RELEASE_DIR}"
fi

log "设置 release 权限：${ADMIN_SERVICE_USER}:${ADMIN_SERVICE_GROUP}"
chown -R "${ADMIN_SERVICE_USER}:${ADMIN_SERVICE_GROUP}" "${RELEASE_DIR}"
chmod -R u=rwX,g=rX,o= "${RELEASE_DIR}"

# ---------------------------------------------------------------- SQLite 备份

DATABASE_URL_VALUE="${DATABASE_URL:-}"
case "${DATABASE_URL_VALUE}" in
  file://*) DB_PATH="${DATABASE_URL_VALUE#file://}" ;;
  file:*) DB_PATH="${DATABASE_URL_VALUE#file:}" ;;
  *) die "DATABASE_URL 必须是 file: SQLite 路径" ;;
esac
DB_PATH="${DB_PATH%%\?*}"
case "${DB_PATH}" in
  /*) ;;
  *) die "DATABASE_URL 必须使用绝对路径，当前：${DATABASE_URL_VALUE}" ;;
esac

if [ -f "${DB_PATH}" ]; then
  BACKUP_PATH="${ADMIN_BACKUP_DIR}/admin-${STAMP}.db"
  log "备份 SQLite：${BACKUP_PATH}"
  if ! sqlite3 "${DB_PATH}" ".backup '${BACKUP_PATH}'"; then
    die "SQLite 在线备份失败"
  fi
  chown "${ADMIN_SERVICE_USER}:${ADMIN_SERVICE_GROUP}" "${BACKUP_PATH}"
  chmod 600 "${BACKUP_PATH}"

  mapfile -t OLD_BACKUPS < <(
    find "${ADMIN_BACKUP_DIR}" -maxdepth 1 -type f -name 'admin-*.db' -printf '%T@ %p\n' \
      | sort -rn \
      | awk 'NR > 10 {$1 = ""; sub(/^ /, ""); print}'
  )
  for old_backup in "${OLD_BACKUPS[@]}"; do
    [ -n "${old_backup}" ] && rm -f -- "${old_backup}"
  done
  log "SQLite 备份完成；已保留最近 10 份 admin-*.db"
else
  log "SQLite 文件尚不存在，跳过首次备份：${DB_PATH}"
fi

# ---------------------------------------------------------------- 迁移

log "以 ${ADMIN_SERVICE_USER} 执行 Payload 迁移：${RELEASE_DIR}/migrate.mjs"
if ! runuser -u "${ADMIN_SERVICE_USER}" -- env \
  HOME="${ADMIN_DEPLOY_ROOT}" \
  NODE_ENV=production \
  NODE_OPTIONS="--max-old-space-size=512" \
  DATABASE_URL="${DATABASE_URL_VALUE}" \
  PAYLOAD_SECRET="${PAYLOAD_SECRET:-}" \
  ADMIN_MIGRATION_DIR="${RELEASE_DIR}/migrations" \
  /usr/bin/node "${RELEASE_DIR}/migrate.mjs"; then
  die "Payload 迁移失败，未切换 app"
fi

# ---------------------------------------------------------------- 原子切链

OLD_TARGET=""
if [ -L "${ADMIN_APP_LINK}" ]; then
  OLD_TARGET="$(readlink "${ADMIN_APP_LINK}")"
  log "当前 app -> ${OLD_TARGET}"
elif [ -e "${ADMIN_APP_LINK}" ]; then
  die "app 路径已存在且不是软链：${ADMIN_APP_LINK}"
else
  log "当前没有 app 软链（首次发布）"
fi

restore_app() {
  if [ -n "${OLD_TARGET}" ]; then
    log "回滚 app 软链：${OLD_TARGET}"
    ln -s "${OLD_TARGET}" "${ADMIN_APP_LINK}.new"
    mv -Tf "${ADMIN_APP_LINK}.new" "${ADMIN_APP_LINK}"
    systemctl restart "${ADMIN_SERVICE}" || true
  else
    log "没有旧 app，移除失败的 app 软链"
    rm -f "${ADMIN_APP_LINK}"
  fi
}

log "原子切换 app：releases/${RELEASE_NAME}"
ln -s "releases/${RELEASE_NAME}" "${ADMIN_APP_LINK}.new"
mv -Tf "${ADMIN_APP_LINK}.new" "${ADMIN_APP_LINK}"

if ! systemctl restart "${ADMIN_SERVICE}"; then
  restore_app
  die "后台服务重启失败，已回滚 app"
fi

HEALTH_OK=0
for _ in $(seq 1 30); do
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${HEALTH_URL}" || echo '000')"
  if [ "${CODE}" = "200" ]; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [ "${HEALTH_OK}" != "1" ]; then
  restore_app
  die "健康检查失败：${HEALTH_URL} 未返回 200，已回滚 app"
fi

# ---------------------------------------------------------------- 收尾

OLD_DISPLAY="${OLD_TARGET:-（无，首次发布）}"
log "后台发布成功"
log "release tag：${ADMIN_RELEASE_TAG}"
log "release：releases/${RELEASE_NAME}"
log "app：${ADMIN_APP_LINK}"
log "旧 release：${OLD_DISPLAY}"
log "健康检查：${HEALTH_URL} -> 200"

{
  printf '%s release_tag=%s release=%s old_release=%s health=ok\n' \
    "$(date -Is)" "${ADMIN_RELEASE_TAG}" "releases/${RELEASE_NAME}" "${OLD_DISPLAY}"
} >> "${LOG_DIR}/admin-deploy.log"
