#!/usr/bin/env bash
#
# ops/deploy-server.sh —— 服务器侧发布脚本（GitHub 驱动）
#
# 站点拆成两个仓库：代码仓库（本仓库）与内容仓库（图片 / 投稿 / 清单）。
# 发布时两份工作树都要更新，构建在代码工作树里跑、内容由 --content-dir 指过去。
#
# 流程（顺序固定，不要调换）：
#   1. 加载配置并校验必填变量；
#   2. flock 防并发发布；
#   3. 拉取代码仓库 origin/<BRANCH> 到 SOURCE_DIR、内容仓库
#      origin/<CONTENT_BRANCH> 到 CONTENT_DIR（只动这两份工作树，不碰 current）；
#   4. staging 临时目录里跑 tools/build_site.mjs（内部顺序：同步内容 → 快照 →
#      详情页 → sitemap → tools/build.mjs）；
#   4b. 预压缩（默认开启）：对产物跑 tools/compress_static.mjs --precompress 生成 .gz
#      （PRECOMPRESS=0/false/no/off 可关闭；必须在 chmod / 删 .build-output / cp -al 之前）；
#   5. 先 chmod 构建产物，再 cp -al 硬链接 shared/data（顺序不能反）；
#   6. 校验产物关键文件；
#   7. nginx -t；
#   8. 产物 mv 进 releases/<YYYYmmdd-HHMMSS>；
#   9. 原子切 current；
#  10. 健康检查；
#  11. 任一健康检查失败：原子切回旧 current 并非零退出；
#  12. 成功则把摘要追加到 logs/deploy.log。
#
# 这个文件是公开仓库的一部分：不写死域名、IP、凭据或服务器绝对路径，
# 全部从环境变量读取；可选由 DEPLOY_ENV 指定一个配置文件。环境变量优先于文件。

set -euo pipefail

log() {
  printf '[deploy] %s %s\n' "$(date -Is)" "$*"
}

die() {
  printf '[deploy] %s 错误：%s\n' "$(date -Is)" "$*" >&2
  exit 1
}

# ---------------------------------------------------------------- 配置加载

CONFIG_FILE="${DEPLOY_ENV:-}"
CONFIG_VARS=(DEPLOY_ROOT SOURCE_DIR REPO_URL BRANCH HEALTH_URL CONTENT_REPO_URL CONTENT_BRANCH CONTENT_DIR SHARED_DATA_DIR RELEASES_DIR CURRENT_LINK PRECOMPRESS)

# 先记住当前已经通过环境变量给出的值，读完配置文件后再覆盖回去（环境变量优先）。
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

# 内容仓库分支默认跟随代码仓库分支。
CONTENT_BRANCH="${CONTENT_BRANCH:-${BRANCH:-}}"

MISSING=()
for name in DEPLOY_ROOT SOURCE_DIR REPO_URL BRANCH HEALTH_URL CONTENT_REPO_URL CONTENT_BRANCH CONTENT_DIR; do
  if [ -z "${!name:-}" ]; then
    MISSING+=("${name}")
  fi
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  die "配置缺失，必须提供：${MISSING[*]}"
fi

if [ "${SOURCE_DIR}" = "${CONTENT_DIR}" ]; then
  die "SOURCE_DIR 与 CONTENT_DIR 不能是同一个目录（代码仓库与内容仓库必须分开）"
fi

SHARED_DATA_DIR="${SHARED_DATA_DIR:-${DEPLOY_ROOT}/shared/data}"
RELEASES_DIR="${RELEASES_DIR:-${DEPLOY_ROOT}/releases}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"
STAGING_ROOT="${DEPLOY_ROOT}/.staging"
LOG_DIR="${DEPLOY_ROOT}/logs"
HEALTH_URL="${HEALTH_URL%/}"

# 可选：构建后对发布产物做 gzip 预压缩（生成 .gz 供 nginx `gzip_static on`）。
# 默认 1（开启）：正式发布默认生成 .gz。服务器必须人工启用 nginx `gzip_static on` 才会
# 真正回发 .gz；若暂时不开，产物里多出的 .gz 只是发布包里的额外文件，不影响站点行为。
# 想关闭就显式设 PRECOMPRESS=0/false/no/off；只认下面列出的真假写法，写别的值直接报错，
# 避免「以为是关、其实还开着」。
PRECOMPRESS="${PRECOMPRESS:-1}"
case "${PRECOMPRESS}" in
  1 | true | TRUE | yes | YES | on | ON) PRECOMPRESS_ENABLED=1 ;;
  0 | false | FALSE | no | NO | off | OFF | "") PRECOMPRESS_ENABLED=0 ;;
  *) die "PRECOMPRESS 只能是 0/1/true/false（收到：${PRECOMPRESS}）" ;;
esac

log "DEPLOY_ROOT=${DEPLOY_ROOT}"
log "SOURCE_DIR=${SOURCE_DIR}（代码仓库）"
log "REPO_URL=${REPO_URL}"
log "BRANCH=${BRANCH}"
log "CONTENT_DIR=${CONTENT_DIR}（内容仓库）"
log "CONTENT_REPO_URL=${CONTENT_REPO_URL}"
log "CONTENT_BRANCH=${CONTENT_BRANCH}"
log "HEALTH_URL=${HEALTH_URL}"
log "SHARED_DATA_DIR=${SHARED_DATA_DIR}"
log "RELEASES_DIR=${RELEASES_DIR}"
log "CURRENT_LINK=${CURRENT_LINK}"
log "PRECOMPRESS=${PRECOMPRESS}（默认开启；1/true 时构建后生成 .gz，供 nginx gzip_static）"

# ---------------------------------------------------------------- 防并发

mkdir -p "${DEPLOY_ROOT}" "${RELEASES_DIR}" "${STAGING_ROOT}" "${LOG_DIR}"

exec 9>"${DEPLOY_ROOT}/.deploy.lock"
if ! flock -n 9; then
  die "另一个发布正在进行（拿不到 ${DEPLOY_ROOT}/.deploy.lock），退出"
fi
log "已获得发布锁 ${DEPLOY_ROOT}/.deploy.lock"

# ---------------------------------------------------------------- 准备源码

# 代码仓库工作树（站点源码：页面 / 样式 / 生成器 / 构建器）。
if [ ! -d "${SOURCE_DIR}/.git" ]; then
  log "代码仓库工作树不存在，开始克隆：${REPO_URL} -> ${SOURCE_DIR}"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${SOURCE_DIR}"
else
  log "拉取最新代码：git fetch --prune origin（工作树 ${SOURCE_DIR}）"
  git -C "${SOURCE_DIR}" fetch --prune origin
  log "重置工作树到 origin/${BRANCH}（只动 SOURCE_DIR，不碰 current）"
  git -C "${SOURCE_DIR}" reset --hard "origin/${BRANCH}"
fi

COMMIT_SHA="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
COMMIT_SUBJECT="$(git -C "${SOURCE_DIR}" log -1 --pretty=%s)"
log "将要发布的代码提交：${COMMIT_SHA} ${COMMIT_SUBJECT}"

# 内容仓库工作树（图片 / 投稿 / 清单）。构建只读它，不改它的数据。
if [ ! -d "${CONTENT_DIR}/.git" ]; then
  log "内容仓库工作树不存在，开始克隆：${CONTENT_REPO_URL} -> ${CONTENT_DIR}"
  git clone --branch "${CONTENT_BRANCH}" "${CONTENT_REPO_URL}" "${CONTENT_DIR}"
else
  log "拉取最新内容：git fetch --prune origin（工作树 ${CONTENT_DIR}）"
  git -C "${CONTENT_DIR}" fetch --prune origin
  log "重置内容工作树到 origin/${CONTENT_BRANCH}"
  git -C "${CONTENT_DIR}" reset --hard "origin/${CONTENT_BRANCH}"
fi

CONTENT_COMMIT_SHA="$(git -C "${CONTENT_DIR}" rev-parse HEAD)"
CONTENT_COMMIT_SUBJECT="$(git -C "${CONTENT_DIR}" log -1 --pretty=%s)"
log "将要发布的内容提交：${CONTENT_COMMIT_SHA} ${CONTENT_COMMIT_SUBJECT}"

# ---------------------------------------------------------------- staging

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGING_DIR="${STAGING_ROOT}/${STAMP}-$$"
mkdir -p "${STAGING_DIR}"
log "创建 staging 目录：${STAGING_DIR}"

cleanup_staging() {
  if [ -d "${STAGING_DIR}" ]; then
    log "清理 staging 目录：${STAGING_DIR}"
    rm -rf "${STAGING_DIR}"
  fi
}
trap cleanup_staging EXIT

log "运行构建：node ${SOURCE_DIR}/tools/build_site.mjs --content-dir ${CONTENT_DIR} --out ${STAGING_DIR}/site"
if ! node "${SOURCE_DIR}/tools/build_site.mjs" --content-dir "${CONTENT_DIR}" --out "${STAGING_DIR}/site"; then
  die "构建失败，未改动 current"
fi
log "构建完成：${STAGING_DIR}/site"

# ------------------------------------------------- 预压缩（默认开启；必须在 chmod / 删 .build-output / cp -al 之前）
# PRECOMPRESS 默认 1：给刚构建好的产物生成同名 .gz，供 nginx `gzip_static on` 直接回发，
# 省掉每个请求的实时压缩 CPU。显式设 PRECOMPRESS=0/false/no/off 可关闭（见上方 PRECOMPRESS 归一化）。
# 位置很关键：必须在 chmod（否则新写的 .gz 权限不对）、删 .build-output、cp -al data 之前。
# 预压缩失败要保持 current 不变，所以这里直接 die，此时还没动过 release / 软链。
# 提醒：脚本只生成 .gz，不会自动改服务器 nginx 配置；必须人工启用 `gzip_static on` 才会用到。
if [ "${PRECOMPRESS_ENABLED}" = "1" ]; then
  log "预压缩产物文本资源：node ${SOURCE_DIR}/tools/compress_static.mjs --dir ${STAGING_DIR}/site --precompress"
  if ! node "${SOURCE_DIR}/tools/compress_static.mjs" --dir "${STAGING_DIR}/site" --precompress; then
    die "预压缩失败，未改动 current"
  fi
  PRECOMPRESSED_COUNT="$(find "${STAGING_DIR}/site" -type f -name '*.gz' | wc -l | tr -d ' ')" || PRECOMPRESSED_COUNT="unknown"
  log "预压缩完成：生成 ${PRECOMPRESSED_COUNT} 个 .gz（nginx 还需开 gzip_static on 才会用到）"
fi

# ------------------------------------------------- 权限（必须在 cp -al 之前）

log "设置产物权限：目录 755、文件 644（此时产物里还没有 data）"
find "${STAGING_DIR}/site" -type d -exec chmod 755 {} +
find "${STAGING_DIR}/site" -type f -exec chmod 644 {} +

# 产物根上的 .build-output 是 tools/build.mjs 的内部标记（只给本地构建识别用），
# 不随发布产物上线。必须放在 cp -al 之前删，之后就不能再 chmod / 改动产物了。
rm -f "${STAGING_DIR}/site/.build-output"

# 站点要托管的首批图片（dist/data/）不在发布产物里：build.mjs 会跳过 data/，
# 线上统一由 DEPLOY_ROOT/shared/data 这份持久副本硬链接进每个 release。
# 内容仓库现在也跟踪 dist/data/，但 shared/data 仍是线上权威副本；如果内容仓库
# 的 dist/data/ 有变化（例如把超限 GIF 换成动画 WebP），要另行把它刷进
# shared/data，否则 release 里的预览图会与 site-data.json 对不上。这份刷新是
# 显式的运维动作，本脚本不自动覆盖 shared/data。
if [ ! -d "${SHARED_DATA_DIR}" ]; then
  die "共享数据目录不存在：${SHARED_DATA_DIR}"
fi
if [ ! -d "${CONTENT_DIR}/dist/data" ]; then
  die "内容工作树里找不到 dist/data：${CONTENT_DIR}/dist/data"
fi
log "硬链接共享数据：cp -al ${SHARED_DATA_DIR} ${STAGING_DIR}/site/data"
# 硬链接共享 inode 与权限。这里是 cp -al 之后绝不能再对产物做 chmod -R 的原因：
# 那会顺着硬链接改掉 shared/data 以及所有旧 release 里同一 inode 的权限。
cp -al "${SHARED_DATA_DIR}" "${STAGING_DIR}/site/data"

# ---------------------------------------------------------------- 校验产物

for required in \
  "${STAGING_DIR}/site/index.html" \
  "${STAGING_DIR}/site/data/blue-fish-classification.json" \
  "${STAGING_DIR}/site/submissions/works.json" \
  "${STAGING_DIR}/site/site-data.json" \
  "${STAGING_DIR}/site/sitemap.xml" \
  "${STAGING_DIR}/site/google653ce5fe960a5fb0.html"; do
  if [ ! -f "${required}" ]; then
    die "产物缺少必需文件：${required}"
  fi
done
log "产物校验通过：首页 / 首批数据 / 投稿清单 / site-data / sitemap / Google 验证文件均存在"

# ---------------------------------------------------------------- nginx

log "校验 nginx 配置：nginx -t"
if ! nginx -t; then
  die "nginx -t 未通过，未改动 current"
fi

# ---------------------------------------------------------------- 落 release

RELEASE_NAME="${STAMP}"
if [ -e "${RELEASES_DIR}/${RELEASE_NAME}" ]; then
  RELEASE_NAME="${STAMP}-$$"
fi
RELEASE_PATH="${RELEASES_DIR}/${RELEASE_NAME}"

OLD_TARGET=""
if [ -L "${CURRENT_LINK}" ]; then
  OLD_TARGET="$(readlink "${CURRENT_LINK}")"
  log "当前 current -> ${OLD_TARGET}"
else
  log "当前没有 current 软链（首次发布）"
fi

log "把产物移入 release：mv ${STAGING_DIR}/site ${RELEASE_PATH}"
mv "${STAGING_DIR}/site" "${RELEASE_PATH}"

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
    log "之前没有 current，移除失败的 current 软链"
    rm -f "${CURRENT_LINK}"
  fi
}

# ---------------------------------------------------------------- 健康检查

# 取一张预览图用于回读。必须换算成相对站点根的路径，否则拼出的 URL 会带
# 服务器绝对路径（如 //srv/www/...），落在文档根之外必然 404。
PREVIEW_ABS="$(
  set +o pipefail
  find "${RELEASE_PATH}/submissions/previews" -type f -name '*.webp' 2>/dev/null | sort | head -n 1
)"
PREVIEW_REL="${PREVIEW_ABS#"${RELEASE_PATH}"/}"
WORK_ABS="$(
  set +o pipefail
  find "${RELEASE_PATH}/works" -type f -name '*.html' 2>/dev/null | sort | head -n 1
)"
WORK_REL="${WORK_ABS#"${RELEASE_PATH}"/}"
if [ -z "${PREVIEW_REL}" ]; then
  log "健康检查失败：release 里找不到 submissions/previews/*.webp"
  restore_current
  die "健康检查失败（无预览图可回读），current 已回滚"
fi
if [ -z "${WORK_REL}" ]; then
  log "健康检查失败：release 里找不到 works/*.html"
  restore_current
  die "健康检查失败（无详情页可回读），current 已回滚"
fi

check_ok() {
  local url="$1" expected_len="${2:-0}"
  local result code size
  result="$(curl -sS -o /dev/null -w '%{http_code} %{size_download}' --max-time 20 "${url}" || echo '000 0')"
  code="${result%% *}"
  size="${result##* }"
  if [ "${code}" != "200" ]; then
    log "健康检查失败：${url} 返回 ${code}"
    return 1
  fi
  if [ "${expected_len}" -gt 0 ] && [ "${size}" -le 0 ]; then
    log "健康检查失败：${url} 内容长度为 0"
    return 1
  fi
  log "健康检查通过：${url} -> 200（${size} bytes）"
  return 0
}

HEALTH_FAILED=""
for path in "/" "/robots.txt" "/submissions/works.json" "/site-data.json" "/sitemap.xml" "/google653ce5fe960a5fb0.html" "/${WORK_REL}"; do
  if ! check_ok "${HEALTH_URL}${path}"; then
    HEALTH_FAILED="${HEALTH_URL}${path}"
    break
  fi
done

if [ -z "${HEALTH_FAILED}" ]; then
  if ! check_ok "${HEALTH_URL}/${PREVIEW_REL}" 1; then
    HEALTH_FAILED="${HEALTH_URL}/${PREVIEW_REL}"
  fi
fi

if [ -n "${HEALTH_FAILED}" ]; then
  restore_current
  die "健康检查失败于 ${HEALTH_FAILED}，current 已回滚到 ${OLD_TARGET:-（无）}"
fi

# 统计命令只用于收尾日志，放在健康检查通过之后且非致命：
# 万一失败也不能让 current 停在未验证的新版本上（此时健康检查已经过了，
# 但绝不能因为这行让 set -e 提前退出而跳过任何后续收尾）。
PUBLISHED_COUNT="$(node -e 'const a=require(process.argv[1]);console.log(a.filter(r=>r.status==="published").length)' "${RELEASE_PATH}/submissions/works.json" 2>/dev/null)" || PUBLISHED_COUNT="unknown"
log "构建产物 published 记录数：${PUBLISHED_COUNT}"

# ---------------------------------------------------------------- 成功收尾

OLD_DISPLAY="${OLD_TARGET:-（无，首次发布）}"
log "发布成功"
log "旧 release：${OLD_DISPLAY}"
log "新 release：releases/${RELEASE_NAME}"
log "代码提交：${COMMIT_SHA}"
log "内容提交：${CONTENT_COMMIT_SHA}"
log "健康检查：全部通过（首页 / robots / 投稿清单 / site-data / sitemap / Google 验证 / ${WORK_REL} / ${PREVIEW_REL}）"

{
  printf '%s old_release=%s new_release=%s commit=%s content_commit=%s health=ok published=%s\n' \
    "$(date -Is)" "${OLD_DISPLAY}" "releases/${RELEASE_NAME}" "${COMMIT_SHA}" "${CONTENT_COMMIT_SHA}" "${PUBLISHED_COUNT}"
} >> "${LOG_DIR}/deploy.log"
log "已追加记录到 ${LOG_DIR}/deploy.log"

# 注意：绝不删除任何 release、绝不删除 shared/data、绝不删除 acme。
