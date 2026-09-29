#!/usr/bin/env bash
#
# ops/admin/deploy-admin.sh —— 后台 Next/Payload 服务的服务器侧发布脚本
#
# 与 ops/deploy-server.sh 同样的思路：从 GitHub 拉取代码、在 release 目录里构建，最后原子切换
# app 软链并重启 systemd。失败时只回滚 app 软链，不删除任何 release 方便排查。
#
# 必须由服务器维护者提供 ADMIN_DEPLOY_ROOT / ADMIN_REPO_URL / ADMIN_BRANCH / ADMIN_HEALTH_URL。
# 不写死域名、IP、数据库地址或密钥。

set -euo pipefail

log() { printf '[admin-deploy] %s %s\n' "$(date -Is)" "$*"; }
die() { printf '[admin-deploy] %s 错误：%s\n' "$(date -Is)" "$*" >&2; exit 1; }

ADMIN_ENV_FILE="${ADMIN_ENV_FILE:-/etc/dafeiyu/admin.env}"
if [ -n "${ADMIN_ENV_FILE}" ] && [ -f "${ADMIN_ENV_FILE}" ]; then
  log "加载后台环境文件：${ADMIN_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${ADMIN_ENV_FILE}"
  set +a
else
  log "未找到后台环境文件：${ADMIN_ENV_FILE:-未配置}"
fi

ADMIN_DEPLOY_ROOT="${ADMIN_DEPLOY_ROOT:-}"
ADMIN_REPO_URL="${ADMIN_REPO_URL:-}"
ADMIN_BRANCH="${ADMIN_BRANCH:-}"
ADMIN_HEALTH_URL="${ADMIN_HEALTH_URL:-}"
if [ -z "${ADMIN_DEPLOY_ROOT}" ] || [ -z "${ADMIN_REPO_URL}" ] || [ -z "${ADMIN_BRANCH}" ] || [ -z "${ADMIN_HEALTH_URL}" ]; then
  die "必须提供 ADMIN_DEPLOY_ROOT、ADMIN_REPO_URL、ADMIN_BRANCH、ADMIN_HEALTH_URL"
fi

ADMIN_SOURCE_DIR="${ADMIN_SOURCE_DIR:-${ADMIN_DEPLOY_ROOT}/src}"
ADMIN_RELEASES_DIR="${ADMIN_RELEASES_DIR:-${ADMIN_DEPLOY_ROOT}/releases}"
ADMIN_APP_LINK="${ADMIN_APP_LINK:-${ADMIN_DEPLOY_ROOT}/app}"
ADMIN_SERVICE="${ADMIN_SERVICE:-dafeiyu-admin.service}"
ADMIN_NPM_BIN="${ADMIN_NPM_BIN:-/usr/bin/npm}"
ADMIN_NPX_BIN="${ADMIN_NPX_BIN:-npx}"
LOG_DIR="${ADMIN_DEPLOY_ROOT}/logs"
HEALTH_URL="${ADMIN_HEALTH_URL%/}/admin/login"

mkdir -p "${ADMIN_RELEASES_DIR}" "${LOG_DIR}"
exec 9>"${ADMIN_DEPLOY_ROOT}/.admin-deploy.lock"
if ! flock -n 9; then
  die "已有后台发布在运行：${ADMIN_DEPLOY_ROOT}/.admin-deploy.lock"
fi

if [ ! -d "${ADMIN_SOURCE_DIR}/.git" ]; then
  rm -rf "${ADMIN_SOURCE_DIR}"
  mkdir -p "$(dirname "${ADMIN_SOURCE_DIR}")"
  log "克隆后台源码：${ADMIN_REPO_URL} -> ${ADMIN_SOURCE_DIR}"
  git clone --branch "${ADMIN_BRANCH}" "${ADMIN_REPO_URL}" "${ADMIN_SOURCE_DIR}"
else
  log "拉取后台源码：git -C ${ADMIN_SOURCE_DIR} fetch --prune origin"
  git -C "${ADMIN_SOURCE_DIR}" fetch --prune origin
  log "重置后台源码到 origin/${ADMIN_BRANCH}"
  git -C "${ADMIN_SOURCE_DIR}" reset --hard "origin/${ADMIN_BRANCH}"
fi

COMMIT_SHA="$(git -C "${ADMIN_SOURCE_DIR}" rev-parse HEAD)"
COMMIT_SUBJECT="$(git -C "${ADMIN_SOURCE_DIR}" log -1 --pretty=%s)"
log "将发布后台提交：${COMMIT_SHA} ${COMMIT_SUBJECT}"

STAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="${ADMIN_RELEASES_DIR}/${STAMP}-$$"
mkdir -p "${RELEASE_DIR}"

log "复制 admin/ 到 release：${RELEASE_DIR}"
if [ ! -d "${ADMIN_SOURCE_DIR}/admin" ]; then
  die "站点仓里找不到 admin/：${ADMIN_SOURCE_DIR}/admin"
fi
rsync -a --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .env \
  --exclude admin.db \
  --exclude admin.db-journal \
  --exclude data \
  --exclude media \
  "${ADMIN_SOURCE_DIR}/admin/" "${RELEASE_DIR}/"

log "安装后台依赖：${ADMIN_NPM_BIN} ci"
(cd "${RELEASE_DIR}" && "${ADMIN_NPM_BIN}" ci --no-audit --no-fund)
log "构建后台：${ADMIN_NPM_BIN} run build"
(cd "${RELEASE_DIR}" && "${ADMIN_NPM_BIN}" run build)
log "执行 Payload 数据库迁移"
(cd "${RELEASE_DIR}" && "${ADMIN_NPX_BIN}" payload migrate)

OLD_TARGET=""
if [ -L "${ADMIN_APP_LINK}" ]; then
  OLD_TARGET="$(readlink "${ADMIN_APP_LINK}")"
elif [ -e "${ADMIN_APP_LINK}" ]; then
  die "app 路径已存在且不是软链：${ADMIN_APP_LINK}"
fi

restore_app() {
  if [ -n "${OLD_TARGET}" ]; then
    log "回滚 app 软链：${OLD_TARGET}"
    ln -s "${OLD_TARGET}" "${ADMIN_APP_LINK}.new"
    mv -Tf "${ADMIN_APP_LINK}.new" "${ADMIN_APP_LINK}"
    systemctl restart "${ADMIN_SERVICE}" || true
  else
    rm -f "${ADMIN_APP_LINK}"
  fi
}

log "原子切换 app 软链"
ln -s "releases/${STAMP}-$$" "${ADMIN_APP_LINK}.new"
mv -Tf "${ADMIN_APP_LINK}.new" "${ADMIN_APP_LINK}"

if ! systemctl restart "${ADMIN_SERVICE}"; then
  restore_app
  die "后台服务重启失败，已回滚"
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
  die "健康检查失败：${HEALTH_URL} 未返回 200，已回滚"
fi

log "后台发布成功"
log "提交：${COMMIT_SHA}"
log "release：${RELEASE_DIR}"
log "app：${ADMIN_APP_LINK}"
log "健康检查：${HEALTH_URL} -> 200"

printf '%s commit=%s release=%s health=ok\n' "$(date -Is)" "${COMMIT_SHA}" "${RELEASE_DIR}" >> "${LOG_DIR}/admin-deploy.log"