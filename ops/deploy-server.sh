#!/usr/bin/env bash
#
# ops/deploy-server.sh —— 服务器侧发布脚本（GitHub 驱动）
#
# 站点拆成两个仓库：代码仓库（本仓库，含站点源码 + data/ 结构化清单 + 全部脚本）
# 与内容仓库（图片 / 投稿模板）。发布时两份工作树都要更新，构建在代码工作树里跑、
# 内容由 --content-dir 指过去（构建只从内容仓取图片与模板副本，不读它的 JSON）。
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
#   5. 先 chmod 构建产物；把内容仓首批预览图以临时副本 + rename 同步进
#      shared/data（保留其它文件），再 cp -al 硬链接 shared/data（顺序不能反）；
#   6. 校验产物关键文件；
#   7. nginx -t；
#   8. 产物 mv 进 releases/<YYYYmmdd-HHMMSS>；
#   8b. 用该 release 自己的 works-v2.json 与 release 根跑缺图门禁（>1% 失败）；
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
CONFIG_VARS=(DEPLOY_ROOT SOURCE_DIR REPO_URL BRANCH HEALTH_URL CONTENT_REPO_URL CONTENT_BRANCH CONTENT_DIR SHARED_DATA_DIR RELEASES_DIR CURRENT_LINK PRECOMPRESS BUILD_FULL BUILD_MEMORY_MAX_MB BUILD_NODE_HEAP_MB BUILD_MIN_AVAILABLE_MB BUILD_MIN_DISK_MB)

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

# 内容仓库工作树（图片 / 投稿模板）。构建只读它，不改它的数据。
# 结构化清单已迁到代码仓库的 data/，这里不再有 JSON。
if [ ! -d "${CONTENT_DIR}/.git" ]; then
  log "内容仓库工作树不存在，开始克隆：${CONTENT_REPO_URL} -> ${CONTENT_DIR}"
  git clone --branch "${CONTENT_BRANCH}" "${CONTENT_REPO_URL}" "${CONTENT_DIR}"
else
  log "拉取最新内容：git fetch --prune origin（工作树 ${CONTENT_DIR}）"
  git -C "${CONTENT_DIR}" fetch --prune origin
  log "重置内容工作树到 origin/${CONTENT_BRANCH}"
  git -C "${CONTENT_DIR}" reset --hard "origin/${CONTENT_BRANCH}"
fi

# 构建不读原图（原图下载走 GitHub Raw），部署用的内容工作树只检出派生图与模板，省掉约 330MB。
# 发布器用的是另一份工作树（PUBLISH_CONTENT_DIR），它要从原图生成派生图，不在这里稀疏。
git -C "${CONTENT_DIR}" sparse-checkout set --no-cone '/*' '!/dist/submissions/originals/' '!/blue-fish-originals/' '!/owner-picks/*.png'

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

# Protect the running services from build memory spikes. This scope contains the
# whole child tree; a limit failure aborts staging before current is switched.
BUILD_MEMORY_MAX_MB="${BUILD_MEMORY_MAX_MB:-1280}"
export BUILD_NODE_HEAP_MB="${BUILD_NODE_HEAP_MB:-640}"
export BUILD_MIN_AVAILABLE_MB="${BUILD_MIN_AVAILABLE_MB:-1024}"
export BUILD_DISK_PATH="${DEPLOY_ROOT}"
export BUILD_MIN_DISK_MB="${BUILD_MIN_DISK_MB:-2048}"
for name in BUILD_MEMORY_MAX_MB BUILD_NODE_HEAP_MB BUILD_MIN_AVAILABLE_MB; do
  [[ "${!name}" =~ ^[0-9]+$ ]] || die "${name} 必须是整数 MiB"
done
command -v systemd-run >/dev/null || die "缺少 systemd-run，无法限制构建内存"
log "构建内存保护：总内存上限 ${BUILD_MEMORY_MAX_MB} MiB，Node 堆 ${BUILD_NODE_HEAP_MB} MiB，最低可用内存 ${BUILD_MIN_AVAILABLE_MB} MiB"
guarded_build() {
  local label="$1"
  shift
  systemd-run --quiet --scope --unit="dafeiyu-build-${STAMP}-$$-${label}" \
    -p "MemoryHigh=$((BUILD_MEMORY_MAX_MB * 4 / 5))M" \
    -p "MemoryMax=${BUILD_MEMORY_MAX_MB}M" -p MemorySwapMax=512M \
    -p CPUWeight=50 -p IOWeight=50 \
    node "${SOURCE_DIR}/ops/build-resource-runner.mjs" "${label}" "$@"
}

# Verify the lock file, Node runtime and installed direct dependencies before reuse.
log "校验前端构建依赖（锁文件或运行环境变化时执行 npm ci）"
if ! guarded_build dependencies node "${SOURCE_DIR}/tools/install_frontend.mjs"; then
  die "Astro 构建依赖安装失败，未改动 current"
fi

log "运行构建：node ${SOURCE_DIR}/tools/build_site.mjs --content-dir ${CONTENT_DIR} --out ${STAGING_DIR}/site"
BUILD_STATE_DIR="${DEPLOY_ROOT}/build-state"
mkdir -p "${BUILD_STATE_DIR}"
PREVIOUS_RELEASE="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
PREVIOUS_STATE="${BUILD_STATE_DIR}/$(basename "${PREVIOUS_RELEASE:-missing}").json"
BUILD_FLAGS=()
case "${BUILD_FULL:-0}" in
  1|true|TRUE) BUILD_FLAGS+=(--full) ;;
  0|false|FALSE) ;;
  *) die "BUILD_FULL 必须为 0/1/true/false" ;;
esac
if ! SITE_PREVIOUS_DIR="${CURRENT_LINK}" SITE_PREVIOUS_STATE="${PREVIOUS_STATE}" SITE_REUSE_ASSETS=1 guarded_build site node "${SOURCE_DIR}/tools/build_site.mjs" --content-dir "${CONTENT_DIR}" --out "${STAGING_DIR}/site" "${BUILD_FLAGS[@]}"; then
  die "构建失败，未改动 current"
fi
log "构建完成：${STAGING_DIR}/site"

# Cached HTML can still reference the preceding release's fingerprinted bundles.
# Keep those immutable URLs available while the CDN's HTML cache expires.
if [ -d "${PREVIOUS_RELEASE}/_astro" ]; then
  mkdir -p "${STAGING_DIR}/site/_astro"
  cp -an "${PREVIOUS_RELEASE}/_astro/." "${STAGING_DIR}/site/_astro/"
  log "保留旧页面仍可能引用的带指纹静态资源"
fi

# ------------------------------------------------- 预压缩（默认开启；必须在 chmod / 删 .build-output / cp -al 之前）
# PRECOMPRESS 默认 1：给刚构建好的产物生成同名 .gz，供 nginx `gzip_static on` 直接回发，
# 省掉每个请求的实时压缩 CPU。显式设 PRECOMPRESS=0/false/no/off 可关闭（见上方 PRECOMPRESS 归一化）。
# 位置很关键：必须在 chmod（否则新写的 .gz 权限不对）、删 .build-output、cp -al data 之前。
# 预压缩失败要保持 current 不变，所以这里直接 die，此时还没动过 release / 软链。
# 提醒：脚本只生成 .gz，不会自动改服务器 nginx 配置；必须人工启用 `gzip_static on` 才会用到。
if [ "${PRECOMPRESS_ENABLED}" = "1" ]; then
  log "预压缩产物文本资源：node ${SOURCE_DIR}/tools/compress_static.mjs --dir ${STAGING_DIR}/site --precompress"
  if ! SITE_PREVIOUS_DIR="${CURRENT_LINK}" guarded_build compress node "${SOURCE_DIR}/tools/compress_static.mjs" --dir "${STAGING_DIR}/site" --precompress; then
    die "预压缩失败，未改动 current"
  fi
  PRECOMPRESSED_COUNT="$(find "${STAGING_DIR}/site" -type f -name '*.gz' | wc -l | tr -d ' ')" || PRECOMPRESSED_COUNT="unknown"
  log "预压缩完成：生成 ${PRECOMPRESSED_COUNT} 个 .gz（nginx 还需开 gzip_static on 才会用到）"
fi

# ------------------------------------------------- 权限（必须在 cp -al 之前）

log "设置产物权限：目录 755、文件 644（此时产物里还没有 data）"
find "${STAGING_DIR}/site" -type d ! -perm 755 -exec chmod 755 {} +
find "${STAGING_DIR}/site" -type f ! -perm 644 -exec chmod 644 {} +

# 产物根上的 .build-output 是 tools/build.mjs 的内部标记（只给本地构建识别用），
# 不随发布产物上线。必须放在 cp -al 之前删，之后就不能再 chmod / 改动产物了。
rm -f "${STAGING_DIR}/site/.build-output"
mv "${STAGING_DIR}/site/.build-state.json" "${BUILD_STATE_DIR}/${STAMP}.json"
mv "${STAGING_DIR}/site/.build-plan.json" "${LOG_DIR}/build-plan-${STAMP}.json"
chmod 600 "${BUILD_STATE_DIR}/${STAMP}.json" "${LOG_DIR}/build-plan-${STAMP}.json"

# 站点要托管的首批图片（dist/data/）不在发布产物里：build.mjs 会跳过 data/，
# 线上统一由 DEPLOY_ROOT/shared/data 这份持久副本硬链接进每个 release。
# 内容仓库跟踪 dist/data/blue-fish/previews/ 图片（清单已迁到代码仓库 data/）。
# 发布前把内容仓预览同步进 shared/data/blue-fish/previews：先在 staging 复制一份，
# 再逐文件 rename 到 shared/data。rename 只替换 shared/data 里的目录项；已有 release
# 仍持有旧 inode，不会被原地覆盖，也不会出现“源图已更新、旧 release 图也变了”。
# shared/data 里的其它文件（如 blue-fish-classification.json）不删除、不改动。
if [ ! -d "${SHARED_DATA_DIR}" ]; then
  die "共享数据目录不存在：${SHARED_DATA_DIR}"
fi
PREVIEW_SOURCE="${CONTENT_DIR}/dist/data/blue-fish/previews"
if [ ! -d "${PREVIEW_SOURCE}" ]; then
  die "内容工作树里找不到首批预览图：${PREVIEW_SOURCE}"
fi
if [ -z "$(find "${PREVIEW_SOURCE}" -type f -print -quit)" ]; then
  die "内容工作树里的首批预览图为空：${PREVIEW_SOURCE}"
fi
log "同步首批预览图到共享数据（临时副本 + 原子 rename，保留 shared/data 其它文件）"
SHARED_SYNC_DIR="${STAGING_DIR}/shared-data"
rm -rf "${SHARED_SYNC_DIR}"
mkdir -p "${SHARED_SYNC_DIR}/blue-fish/previews"
cp -a "${PREVIEW_SOURCE}/." "${SHARED_SYNC_DIR}/blue-fish/previews/"
find "${SHARED_SYNC_DIR}" -type d -exec chmod 755 {} +
find "${SHARED_SYNC_DIR}" -type f -exec chmod 644 {} +
mkdir -p "${SHARED_DATA_DIR}/blue-fish/previews"
SYNCED_PREVIEWS=0
while IFS= read -r -d '' rel; do
  dest="${SHARED_DATA_DIR}/blue-fish/previews/${rel#./}"
  mkdir -p "$(dirname "${dest}")"
  mv -f "${SHARED_SYNC_DIR}/blue-fish/previews/${rel#./}" "${dest}"
  SYNCED_PREVIEWS=$((SYNCED_PREVIEWS + 1))
done < <(cd "${SHARED_SYNC_DIR}/blue-fish/previews" && find . -type f -print0)
if [ "${SYNCED_PREVIEWS}" -eq 0 ]; then
  die "首批预览图同步数量为 0，未继续发布"
fi
log "首批预览图已同步：${SYNCED_PREVIEWS} 个文件（旧 release 的共享 inode 不变）"

log "硬链接共享数据：cp -al ${SHARED_DATA_DIR} ${STAGING_DIR}/site/data"
# 硬链接共享 inode 与权限。这里是 cp -al 之后绝不能再对产物做 chmod -R 的原因：
# 那会顺着硬链接改掉 shared/data 以及所有旧 release 里同一 inode 的权限。
cp -al "${SHARED_DATA_DIR}" "${STAGING_DIR}/site/data"

# ---------------------------------------------------------------- 校验产物

for required in \
  "${STAGING_DIR}/site/index.html" \
  "${STAGING_DIR}/site/en/index.html" \
  "${STAGING_DIR}/site/ja/index.html" \
  "${STAGING_DIR}/site/zh-hant/index.html" \
  "${STAGING_DIR}/site/vendor/opencc/cn2t-1.4.2.js" \
  "${STAGING_DIR}/site/404.html" \
  "${STAGING_DIR}/site/submissions/works.json" \
  "${STAGING_DIR}/site/site-data.json" \
  "${STAGING_DIR}/site/works-v2.json" \
  "${STAGING_DIR}/site/open-api/v1/index.json" \
  "${STAGING_DIR}/site/open-api/v1/manifest.json" \
  "${STAGING_DIR}/site/open-api/v1/works/page/1.json" \
  "${STAGING_DIR}/site/build-info.json" \
  "${STAGING_DIR}/site/sitemap.xml" \
  "${STAGING_DIR}/site/google653ce5fe960a5fb0.html"; do
  if [ ! -f "${required}" ]; then
    die "产物缺少必需文件：${required}"
  fi
done
log "产物校验通过：首页 / 自定义 404 / 首批数据 / 投稿清单 / site-data / 开放 API / sitemap / Google 验证文件均存在"

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

# ---------------------------------------------------------------- 实际产物缺图门禁
# 必须在 shared/data 硬链接完成之后、切 current 之前，检查 release 自己的清单。
# prebuilt/noop 也读这份产物内的 works-v2.json，不回退到 source/dist 的旧快照。
IMAGE_GATE="${SOURCE_DIR}/tools/work-image-integrity.mjs"
if [ ! -f "${IMAGE_GATE}" ]; then
  die "缺少发布图片门禁脚本：${IMAGE_GATE}，current 未切换"
fi
log "校验发布产物缺图：node ${IMAGE_GATE} ${RELEASE_PATH}/works-v2.json ${RELEASE_PATH}"
if ! node "${IMAGE_GATE}" "${RELEASE_PATH}/works-v2.json" "${RELEASE_PATH}"; then
  die "发布产物缺图比例超过 1% 或占位图不可用，current 未切换（保留待查 release：${RELEASE_PATH}）"
fi
log "发布产物缺图校验通过（>1% 才失败；<=1% 的缺图 ID 已由门禁打印）"

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
for path in "/" "/en/" "/ja/" "/zh-hant/" "/robots.txt" "/submissions/works.json" "/site-data.json" "/open-api/v1/index.json" "/open-api/v1/manifest.json" "/open-api/v1/works/page/1.json" "/sitemap.xml" "/google653ce5fe960a5fb0.html" "/${WORK_REL}" "/en/${WORK_REL}" "/ja/${WORK_REL}" "/zh-hant/${WORK_REL}" "/vendor/opencc/cn2t-1.4.2.js"; do
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

# ------------------------------------------------- 自定义 404 回读（只提示，绝不判失败）
# 线上 404 由 ops/nginx-performance.conf 的 `error_page 404 /404.html;` 接管，而那句要人工
# include 进 server{} 再 nginx -s reload 才生效 —— 发布脚本只跑 nginx -t，不会替人 reload。
# 这里回读一个必然不存在的地址，把「片段还没生效」这件事写进日志：
# 产物里 404.html 本身上面已经校验过了，退回 nginx 默认错误页只是样子不对，
# 所以这里只 log 不 die，不能让一次正常发布因为还没 reload 而回滚。
NOTFOUND_URL="${HEALTH_URL}/__deploy_404_probe__-${STAMP}"
NOTFOUND_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${NOTFOUND_URL}" || echo '000')"
NOTFOUND_BODY="$(curl -sS --max-time 20 "${NOTFOUND_URL}" 2>/dev/null || true)"
if [ "${NOTFOUND_CODE}" != "404" ]; then
  log "提示：不存在地址回读为 ${NOTFOUND_CODE}（期望 404），本次未验证自定义 404 页"
elif [[ "${NOTFOUND_BODY}" == *"blue-fish-404"* ]]; then
  log "自定义 404 已生效：不存在的地址返回 404 且回发站点自己的 404.html"
else
  log "提示：不存在的地址返回 404，但回发的不是自定义 404.html —— 确认 ops/nginx-performance.conf 里的 error_page 已 include 进 server{} 并 nginx -s reload"
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
