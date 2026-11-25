#!/usr/bin/env bash
#
# ops/rollback-server.sh —— 服务器侧回滚脚本
#
# 用法：ops/rollback-server.sh <release目录名>
#   必须显式给出 releases/ 下的目录名，没有默认值。
#
# 行为：加载同样的配置 -> 校验目标 release 和作品图片 -> 原子切 current -> 健康检查；
#       健康检查失败则把 current 指回原目标并非零退出。
#       不重新构建、不删除任何文件、不动 shared/data、不动 acme。
#       回滚不构建，所以内容仓库相关的 CONTENT_* 变量只读取并打印，不是必填项。
#
# 这个文件是公开仓库的一部分：不写死域名、IP、凭据或服务器绝对路径。

set -euo pipefail

log() {
  printf '[rollback] %s %s\n' "$(date -Is)" "$*"
}

die() {
  printf '[rollback] %s 错误：%s\n' "$(date -Is)" "$*" >&2
  exit 1
}

if [ "$#" -ne 1 ]; then
  die "用法：$0 <release目录名>（必须显式指定，没有默认值）"
fi
RELEASE_NAME="$1"

case "${RELEASE_NAME}" in
  */*|*..*|"")
    die "release 目录名不合法：${RELEASE_NAME}"
    ;;
esac

# ---------------------------------------------------------------- 配置加载

CONFIG_FILE="${DEPLOY_ENV:-}"
CONFIG_VARS=(DEPLOY_ROOT SOURCE_DIR REPO_URL BRANCH HEALTH_URL CONTENT_REPO_URL CONTENT_BRANCH CONTENT_DIR RELEASES_DIR CURRENT_LINK)

declare -A __preset=()
for name in "${CONFIG_VARS[@]}"; do
  if [ -n "${!name:-}" ]; then
    __preset[$name]="${!name}"
  fi
done

if [ -n "${CONFIG_FILE}" ] && [ -f "${CONFIG_FILE}" ]; then
  log "加载配置：${CONFIG_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${CONFIG_FILE}"
  set +a
else
  if [ -n "${CONFIG_FILE}" ]; then
    log "配置文件不存在：${CONFIG_FILE}，只用环境变量"
  else
    log "未提供 DEPLOY_ENV，只用环境变量"
  fi
fi

for name in "${!__preset[@]}"; do
  printf -v "${name}" '%s' "${__preset[$name]}"
done

MISSING=()
for name in DEPLOY_ROOT SOURCE_DIR REPO_URL BRANCH HEALTH_URL; do
  if [ -z "${!name:-}" ]; then
    MISSING+=("${name}")
  fi
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  die "配置缺失，必须提供：${MISSING[*]}"
fi

RELEASES_DIR="${RELEASES_DIR:-${DEPLOY_ROOT}/releases}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"
HEALTH_URL="${HEALTH_URL%/}"

if [ -n "${CONTENT_DIR:-}" ]; then
  log "内容仓库工作树：${CONTENT_DIR}（回滚不构建，仅记录配置）"
fi

RELEASE_PATH="${RELEASES_DIR}/${RELEASE_NAME}"
log "目标 release：${RELEASE_PATH}"

if [ ! -f "${RELEASE_PATH}/index.html" ]; then
  die "目标 release 不存在或缺少 index.html：${RELEASE_PATH}"
fi

# ---------------------------------------------------------------- 防并发

exec 9>"${DEPLOY_ROOT}/.deploy.lock"
if ! flock -n 9; then
  die "另一个发布/回滚正在进行（拿不到 ${DEPLOY_ROOT}/.deploy.lock），退出"
fi
log "已获得发布锁 ${DEPLOY_ROOT}/.deploy.lock"

IMAGE_GATE="${SOURCE_DIR}/tools/work-image-integrity.mjs"
if ! node "${IMAGE_GATE}" "${RELEASE_PATH}/works-v2.json" "${RELEASE_PATH}"; then
  die "目标 release 图片校验失败，current 未切换"
fi

OLD_TARGET=""
if [ -L "${CURRENT_LINK}" ]; then
  OLD_TARGET="$(readlink "${CURRENT_LINK}")"
  log "当前 current -> ${OLD_TARGET}"
else
  log "当前没有 current 软链"
fi

if [ "${OLD_TARGET}" = "releases/${RELEASE_NAME}" ]; then
  log "current 已经指向目标 release，无需切换"
fi

# ---------------------------------------------------------------- 原子切链

log "切换 current：ln -s releases/${RELEASE_NAME} ${CURRENT_LINK}.new && mv -Tf"
ln -s "releases/${RELEASE_NAME}" "${CURRENT_LINK}.new"
mv -Tf "${CURRENT_LINK}.new" "${CURRENT_LINK}"
log "current 现在指向：releases/${RELEASE_NAME}"

restore_current() {
  if [ -n "${OLD_TARGET}" ]; then
    log "回滚 current：指回 ${OLD_TARGET}"
    ln -s "${OLD_TARGET}" "${CURRENT_LINK}.new"
    mv -Tf "${CURRENT_LINK}.new" "${CURRENT_LINK}"
  else
    log "之前没有 current，移除 current 软链"
    rm -f "${CURRENT_LINK}"
  fi
}

# ---------------------------------------------------------------- 健康检查

check_ok() {
  local url="$1"
  local result code size
  result="$(curl -sS -o /dev/null -w '%{http_code} %{size_download}' --max-time 20 "${url}" || echo '000 0')"
  code="${result%% *}"
  size="${result##* }"
  if [ "${code}" != "200" ]; then
    log "健康检查失败：${url} 返回 ${code}"
    return 1
  fi
  log "健康检查通过：${url} -> 200（${size} bytes）"
  return 0
}

HEALTH_FAILED=""
for path in "/" "/robots.txt" "/submissions/works.json"; do
  if ! check_ok "${HEALTH_URL}${path}"; then
    HEALTH_FAILED="${HEALTH_URL}${path}"
    break
  fi
done

if [ -z "${HEALTH_FAILED}" ] && ! node "${IMAGE_GATE}" "${RELEASE_PATH}/works-v2.json" "${RELEASE_PATH}" --http "${HEALTH_URL}"; then
  HEALTH_FAILED="作品图片 HTTP 回读"
fi

if [ -n "${HEALTH_FAILED}" ]; then
  restore_current
  die "健康检查失败于 ${HEALTH_FAILED}，current 已还原到 ${OLD_TARGET:-（无）}"
fi

log "回滚成功"
log "旧 release：${OLD_TARGET:-（无）}"
log "新 release：releases/${RELEASE_NAME}"
log "健康检查：全部通过（首页 / robots.txt / submissions/works.json / 作品图片）"

# 注意：绝不删除任何 release、绝不删除 shared/data、绝不删除 acme。
