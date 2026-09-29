#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${CONTAINER:-hermes-webui}"
ENV_FILE="/etc/dafeiyu-submission.env"
NOTIFY_MODULE="/srv/apps/dafeiyu/source/server/notify.mjs"
ALERT_STATE="/var/lib/dafeiyu/hermes-qqpatch.alerted"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

alert_once() {
    local reason="$1"
    local image_id
    local text

    image_id="$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
    if [[ -z "$image_id" ]]; then
        image_id="unknown"
    fi

    if [[ -f "$ALERT_STATE" ]] && grep -Fqx -- "$image_id" "$ALERT_STATE"; then
        echo "镜像 $image_id 已告警过，跳过重复告警。" >&2
        return 0
    fi

    text="[蓝色大肥鱼] Hermes QQ 适配器补丁失败：container=$CONTAINER rc=$rc image=$image_id；$reason"

    if (
        set -a
        . "$ENV_FILE"
        set +a
        NOTIFY_MODULE="$NOTIFY_MODULE" ALERT_TEXT="$text" node --input-type=module -e 'const { createNotifier } = await import(process.env.NOTIFY_MODULE); await createNotifier({ env: process.env }).send(process.env.ALERT_TEXT);'
    ); then
        if mkdir -p "$(dirname -- "$ALERT_STATE")" && printf '%s\n' "$image_id" >> "$ALERT_STATE"; then
            echo "已发送飞书失败告警。" >&2
        else
            echo "告警已发送，但状态文件写入失败。" >&2
        fi
    else
        echo "飞书失败告警发送失败，忽略。" >&2
    fi
}

DRY_RUN=false
if [[ $# -gt 1 ]]; then
    echo "用法：$0 [--dry-run]" >&2
    exit 2
fi
if [[ $# -eq 1 ]]; then
    if [[ "$1" == "--dry-run" ]]; then
        DRY_RUN=true
    else
        echo "未知参数：$1" >&2
        exit 2
    fi
fi

running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)"
if [[ "$running" != "true" ]]; then
    echo "容器 $CONTAINER 未运行，跳过 QQ 适配器补丁。"
    exit 0
fi

if [[ "$DRY_RUN" == true ]]; then
    set +e
    output="$(docker exec -i "$CONTAINER" /opt/hermes/.venv/bin/python - --check < "$SCRIPT_DIR/patch_qqbot_adapter.py" 2>&1)"
    rc=$?
    set -e
else
    set +e
    output="$(docker exec -i "$CONTAINER" /opt/hermes/.venv/bin/python - < "$SCRIPT_DIR/patch_qqbot_adapter.py" 2>&1)"
    rc=$?
    set -e
fi

if [[ -n "$output" ]]; then
    printf '%s\n' "$output"
fi

if [[ "$DRY_RUN" == true ]]; then
    if [[ $rc -ne 0 && $rc -ne 1 ]]; then
        alert_once "dry-run 补丁检查失败。" || true
    fi
    exit "$rc"
fi

if [[ $rc -eq 0 ]]; then
    exit 0
fi

if [[ $rc -eq 10 ]]; then
    echo "QQ 适配器补丁已应用，重启容器 $CONTAINER。"
    set +e
    docker restart "$CONTAINER" >/dev/null
    restart_rc=$?
    set -e
    if [[ $restart_rc -ne 0 ]]; then
        echo "容器 $CONTAINER 重启失败。" >&2
        alert_once "补丁已应用，但容器重启失败。" || true
        exit "$restart_rc"
    fi
    echo "容器 $CONTAINER 已重启。"
    exit 0
fi

alert_once "补丁脚本返回状态 $rc。" || true
exit "$rc"