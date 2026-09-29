"""Hermes QQ group submission hook for bluedafeiyu."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import tempfile
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger("hermes_plugins.dafeiyu_qq_submission")
logger.info("dafeiyu-qq-submission loaded")

DEFAULT_INBOUND_URL = (
    "https://xn--pssy23gqgbz2d718b.com/api/v1/adapters/qq/events"
)
FORMAT_HINT = "格式：@机器人 投稿 标题 角色 + 图片（例：@机器人 投稿 早安 deepseek）"
COMMAND_RE = re.compile(r"^/?投稿(?:\s+|\Z)")
BOT_MENTION_RE = re.compile(r"^\s*<@!?([^>\s]+)>")
CHARACTER_FILE = Path(__file__).with_name("characters.json")
ROLE_PREFIXES = ("角色:", "角色：")
TITLE_MAX_LENGTH = 64
ERROR_REASON_MAX = 120


DEFAULT_HOURLY_LIMIT = 10
DEFAULT_RATE_FILE = Path(__file__).with_name("rate_state.json")
try:
    SHANGHAI_TIMEZONE = ZoneInfo("Asia/Shanghai")
except ZoneInfoNotFoundError:
    SHANGHAI_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Shanghai")
_rate_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(SHANGHAI_TIMEZONE)


def _hour_key(moment: datetime | None = None) -> str:
    return (moment or _now()).strftime("%Y-%m-%dT%H")


def _next_hour_label(moment: datetime | None = None) -> str:
    current = moment or _now()
    next_hour = current.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return next_hour.strftime("%H:00")


def _hourly_limit() -> int:
    raw = os.environ.get("DAFEIYU_QQ_HOURLY_LIMIT", "").strip()
    if not raw:
        return DEFAULT_HOURLY_LIMIT
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "invalid DAFEIYU_QQ_HOURLY_LIMIT=%r; using %d",
            raw,
            DEFAULT_HOURLY_LIMIT,
        )
        return DEFAULT_HOURLY_LIMIT
    if value <= 0:
        logger.warning(
            "non-positive DAFEIYU_QQ_HOURLY_LIMIT=%r; using %d",
            raw,
            DEFAULT_HOURLY_LIMIT,
        )
        return DEFAULT_HOURLY_LIMIT
    return value


def _rate_file_path() -> Path:
    raw = os.environ.get("DAFEIYU_QQ_RATE_FILE", "").strip()
    if raw:
        return Path(raw).expanduser()
    return DEFAULT_RATE_FILE


def _read_rate_count_unlocked(path: Path, hour: str) -> int:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return 0
    except Exception:
        logger.warning("failed to read qq rate state from %s", path, exc_info=True)
        return 0

    if not isinstance(raw, dict) or raw.get("hour") != hour:
        return 0
    try:
        return max(0, int(raw.get("count", 0)))
    except (TypeError, ValueError):
        logger.warning("invalid qq rate count in %s", path)
        return 0


def _write_rate_count_unlocked(path: Path, hour: str, count: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as state_file:
            fd = -1
            json.dump(
                {"hour": hour, "count": max(0, int(count))},
                state_file,
                ensure_ascii=False,
                separators=(",", ":"),
            )
            state_file.flush()
            os.fsync(state_file.fileno())
        os.replace(temp_name, path)
    except Exception:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def _rate_status() -> tuple[int, int, str]:
    limit = _hourly_limit()
    path = _rate_file_path()
    with _rate_lock:
        moment = _now()
        hour = _hour_key(moment)
        count = _read_rate_count_unlocked(path, hour)
        reset_label = _next_hour_label(moment)
    return max(0, limit - count), limit, reset_label


def _reserve_rate_slot() -> tuple[bool, int, str, str]:
    limit = _hourly_limit()
    path = _rate_file_path()
    with _rate_lock:
        moment = _now()
        hour = _hour_key(moment)
        count = _read_rate_count_unlocked(path, hour)
        reset_label = _next_hour_label(moment)
        if count >= limit:
            return False, limit, hour, reset_label
        count += 1
        _write_rate_count_unlocked(path, hour, count)
    return True, limit, hour, reset_label


def _release_rate_slot(reserved_hour: str) -> None:
    if not reserved_hour:
        return

    path = _rate_file_path()
    with _rate_lock:
        hour = _hour_key()
        if hour != reserved_hour:
            logger.info(
                "qq rate slot release skipped because hour changed reserved_hour=%s current_hour=%s",
                reserved_hour,
                hour,
            )
            return
        count = _read_rate_count_unlocked(path, hour)
        if count <= 0:
            return
        _write_rate_count_unlocked(path, hour, count - 1)


def _quota_full_message(limit: int, reset_label: str | None = None) -> str:
    reset = reset_label or _next_hour_label()
    return f"本小时投稿名额已用完（每小时 {limit} 张），{reset} 后再试"


def _log_text(value: Any, max_length: int = 40) -> str:
    return " ".join(str(value or "").split())[:max_length]


def _list_count(value: Any) -> int:
    return len(value) if isinstance(value, (list, tuple)) else 0


def _raw_attachment_count(event: Any) -> int:
    raw = getattr(event, "raw_message", None)
    if not isinstance(raw, dict):
        return 0
    return _list_count(raw.get("attachments"))


def _chat_id_prefix(value: Any) -> str:
    return str(value or "")[:8]


def _log_dispatch_entry(event: Any) -> None:
    source = getattr(event, "source", None)
    logger.info(
        "pre_gateway_dispatch platform=%r chat_type=%r chat_id_prefix=%r text=%r media_count=%d raw_attachments=%d",
        _platform_value(event),
        getattr(source, "chat_type", None),
        _chat_id_prefix(getattr(source, "chat_id", "")),
        _log_text(getattr(event, "text", "")),
        _list_count(getattr(event, "media_urls", None)),
        _raw_attachment_count(event),
    )


@lru_cache(maxsize=1)
def _character_lookup() -> dict[str, str]:
    """Return {id-or-alias casefold value: canonical id}."""
    try:
        raw = json.loads(CHARACTER_FILE.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("failed to load character list from %s", CHARACTER_FILE)
        return {}

    lookup: dict[str, str] = {}
    if not isinstance(raw, list):
        logger.error("character list is not a JSON array: %s", CHARACTER_FILE)
        return lookup

    for item in raw:
        if not isinstance(item, dict):
            continue
        character_id = str(item.get("id") or "").strip()
        if not character_id:
            continue
        values = [character_id]
        aliases = item.get("aliases")
        if isinstance(aliases, list):
            values.extend(str(alias).strip() for alias in aliases)
        for value in values:
            if value:
                lookup[value.casefold()] = character_id
    return lookup


@lru_cache(maxsize=1)
def _character_ids() -> tuple[str, ...]:
    """Return canonical character ids in characters.json order."""
    return tuple(dict.fromkeys(_character_lookup().values()))


def _platform_value(event: Any) -> Any:
    platform = getattr(getattr(event, "source", None), "platform", None)
    return getattr(platform, "value", platform)


def _raw_group_id(event: Any) -> str:
    raw = getattr(event, "raw_message", None)
    if not isinstance(raw, dict):
        return ""
    return str(raw.get("group_openid") or "").strip()


def _raw_user_id(event: Any) -> str:
    raw = getattr(event, "raw_message", None)
    if not isinstance(raw, dict):
        return ""
    author = raw.get("author")
    if not isinstance(author, dict):
        return ""
    return str(author.get("member_openid") or "").strip()


def _event_type(event: Any) -> str:
    """Return an explicit QQ event type when Hermes exposes one."""
    raw = getattr(event, "raw_message", None)
    values = [
        getattr(event, "event_type", None),
        getattr(event, "type", None),
    ]
    if isinstance(raw, dict):
        values.extend(
            [
                raw.get("event_type"),
                raw.get("type"),
                raw.get("t"),
            ]
        )
    normalized = [str(value).strip().upper() for value in values if value]
    if "GROUP_AT_MESSAGE_CREATE" in normalized:
        return "GROUP_AT_MESSAGE_CREATE"
    return normalized[0] if normalized else ""


def _configured_bot_openid() -> str:
    return os.environ.get("DAFEIYU_QQ_BOT_OPENID", "").strip()


def _mention_openid(item: dict[str, Any]) -> str:
    for key in ("openid", "user_openid", "member_openid", "id"):
        value = item.get(key)
        if value:
            return str(value).strip()
    return ""


def _mention_is_self(item: Any, configured_openid: str) -> bool:
    if not isinstance(item, dict):
        return False

    mentioned_openid = _mention_openid(item)
    if (
        configured_openid
        and mentioned_openid
        and mentioned_openid.casefold() == configured_openid.casefold()
    ):
        return True

    return item.get("is_you") is True or item.get("is_self") is True


def _is_bot_mentioned(event: Any) -> bool:
    """Return whether the raw QQ message mentions this bot.

    Content prefix is authoritative for full ``GROUP_MESSAGE_CREATE`` events.
    Older @-only events may omit ``content``; in that case they are accepted so
    the historical Hermes behavior remains compatible.
    """
    raw = getattr(event, "raw_message", None)
    if not isinstance(raw, dict):
        return True
    if "content" not in raw:
        return True

    content = str(raw.get("content") or "")
    match = BOT_MENTION_RE.match(content)
    if match:
        configured_openid = _configured_bot_openid()
        if not configured_openid:
            return True
        mentioned_openid = match.group(1).strip()
        return mentioned_openid.casefold() == configured_openid.casefold()

    configured_openid = _configured_bot_openid()
    mentions = raw.get("mentions")
    if isinstance(mentions, (list, tuple)):
        for mention in mentions:
            if _mention_is_self(mention, configured_openid):
                return True

    return _event_type(event) == "GROUP_AT_MESSAGE_CREATE"


def _resolve_character(marker: str) -> tuple[str, str]:
    """Return (user-facing role value, canonical id or empty)."""
    value = marker.strip()
    for prefix in ROLE_PREFIXES:
        if value.startswith(prefix):
            value = value[len(prefix):].strip()
            break

    canonical = _character_lookup().get(value.casefold(), "")
    if not canonical and len(value) > 1 and value.endswith("娘"):
        base_value = value[:-1].strip()
        canonical = _character_lookup().get(base_value.casefold(), "")
    return value, canonical


def _parse_submission(text: str) -> tuple[str, str, str, str]:
    """Return (title, canonical role, error code, user-facing role value)."""
    parts = text.split()
    if not parts:
        return "", "", "missing_both", ""

    if len(parts) == 1:
        role_value, canonical = _resolve_character(parts[0])
        if canonical:
            return "", canonical, "missing_title", role_value
        return "", "", "missing_role", role_value

    title = " ".join(parts[:-1])
    role_value, canonical = _resolve_character(parts[-1])
    if not canonical:
        return title, "", "unknown_role", role_value
    return title, canonical, "", role_value


def _inline_image_count(event: Any) -> int:
    raw = getattr(event, "raw_message", None)
    if not isinstance(raw, dict):
        return 0
    attachments = raw.get("attachments")
    if not isinstance(attachments, (list, tuple)):
        return 0

    count = 0
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        content_type = str(attachment.get("content_type") or "").lower()
        if content_type.startswith("image/"):
            count += 1
    return count


def _has_quoted_message(event: Any) -> bool:
    raw = getattr(event, "raw_message", None)
    if not isinstance(raw, dict):
        return False
    if raw.get("msg_elements"):
        return True
    message_type = raw.get("message_type")
    return message_type == 103 or str(message_type) == "103"


def _image_paths(event: Any) -> list[str]:
    """Return only the image paths belonging to current-message attachments."""
    inline_count = _inline_image_count(event)
    if inline_count <= 0:
        return []

    media_urls = getattr(event, "media_urls", None)
    media_types = getattr(event, "media_types", None)
    if not isinstance(media_urls, (list, tuple)):
        return []
    if not isinstance(media_types, (list, tuple)):
        return []

    paths = []
    for path, media_type in zip(media_urls[:inline_count], media_types[:inline_count]):
        if str(media_type or "").lower().startswith("image/"):
            paths.append(str(path))
    return paths


def _submission_error(message: str) -> str:
    return f"{message}\n{FORMAT_HINT}"


def _invalid_submission(
    gateway: Any,
    event: Any,
    message: str,
) -> dict[str, str]:
    logger.info("decision=invalid-submission message=%r", message)
    _schedule(_send_reply(gateway, event, _submission_error(message)))
    return {"action": "skip", "reason": "qqbot-invalid-submission"}


def _short_reason(value: Any) -> str:
    text = " ".join(str(value or "").split()).strip()
    if len(text) > ERROR_REASON_MAX:
        text = text[: ERROR_REASON_MAX - 3] + "..."
    return text


def _json_object(body: bytes) -> dict[str, Any]:
    if not body:
        return {}
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _error_reason(body: bytes, fallback: str) -> str:
    parsed = _json_object(body)
    reason = _short_reason(parsed.get("error"))
    return reason or fallback


def _post_image(
    image_path: str,
    url: str,
    token: str,
    payload_base: dict[str, Any],
) -> tuple[str, str]:
    """Read and submit one image. Runs in a worker thread via asyncio.to_thread."""
    with open(image_path, "rb") as image_file:
        encoded = base64.b64encode(image_file.read()).decode("ascii")

    payload = dict(payload_base)
    payload["image"] = {"base64": encoded}
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status = getattr(response, "status", None)
            if status is None:
                status = response.getcode()
            body = response.read()
    except urllib.error.HTTPError as error:
        body = error.read()
        return "error", _error_reason(body, f"HTTP {error.code}")
    except Exception as error:
        return "error", _short_reason(error) or error.__class__.__name__

    parsed = _json_object(body)
    if int(status) == 202 and parsed.get("ok") is True:
        return "accepted", ""
    if int(status) == 200 and parsed.get("ok") is True:
        return "duplicate", ""
    return "error", _error_reason(body, f"HTTP {status}")


def _log_task_result(task: asyncio.Task[Any]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        return
    except Exception:
        logger.exception("qq submission background task failed")


def _schedule(coro: Any) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("no running event loop; qq submission reply skipped")
        coro.close()
        return

    try:
        task = loop.create_task(coro)
        task.add_done_callback(_log_task_result)
    except Exception:
        coro.close()
        logger.exception("failed to schedule qq submission background task")


async def _send_reply(gateway: Any, event: Any, text: str) -> None:
    source = getattr(event, "source", None)
    chat_id = getattr(source, "chat_id", "")
    message_id = getattr(event, "message_id", None)
    platform = getattr(source, "platform", None)
    try:
        adapter = gateway.adapters.get(platform)
        if adapter is None:
            logger.info(
                "qq submission reply failed chat_id_prefix=%s reason=adapter-not-found platform=%r",
                _chat_id_prefix(chat_id),
                platform,
            )
            logger.error("qq adapter not found for platform %r", platform)
            return

        send_result = await adapter.send(chat_id, text, reply_to=message_id)
        if hasattr(send_result, "success") or hasattr(send_result, "error"):
            success_value = getattr(send_result, "success", None)
            error_value = getattr(send_result, "error", None)
            outcome = "sent" if success_value is not False and not error_value else "failed"
            logger.info(
                "qq submission reply %s chat_id_prefix=%s reply_to=%r success=%r error=%r",
                outcome,
                _chat_id_prefix(chat_id),
                message_id,
                success_value,
                error_value,
            )
        else:
            logger.info(
                "qq submission reply sent chat_id_prefix=%s reply_to=%r result=%r",
                _chat_id_prefix(chat_id),
                message_id,
                send_result,
            )
    except Exception as error:
        logger.info(
            "qq submission reply failed chat_id_prefix=%s reply_to=%r error=%r",
            _chat_id_prefix(chat_id),
            message_id,
            error,
        )
        logger.exception("failed to send qq submission reply")


async def _process_submission(
    *,
    gateway: Any,
    event: Any,
    title: str,
    image_paths: list[str],
    url: str,
    token: str,
    payload_base: dict[str, Any],
) -> None:
    for index, image_path in enumerate(image_paths):
        allowed, limit, reserved_hour, reset_label = _reserve_rate_slot()
        if not allowed:
            logger.info(
                "decision=quota-full limit=%d remaining=0 reset=%s unsubmitted=%d",
                limit,
                reset_label,
                len(image_paths) - index,
            )
            await _send_reply(
                gateway,
                event,
                _quota_full_message(limit, reset_label),
            )
            return

        try:
            result, reason = await asyncio.to_thread(
                _post_image,
                image_path,
                url,
                token,
                payload_base,
            )
        except Exception as error:
            logger.exception("failed to submit qq image %s", image_path)
            result, reason = "error", _short_reason(error) or error.__class__.__name__

        if result == "accepted":
            remaining, current_limit, current_reset = _rate_status()
            reply = (
                f"已收到投稿《{title}》，审核结果会稍后公布。"
                f"本小时剩余投稿次数：{remaining}/{current_limit}"
                f"（{current_reset} 重置）"
            )
            logger.info(
                "submission result=accepted image_path=%s remaining=%d/%d reset=%s",
                image_path,
                remaining,
                current_limit,
                current_reset,
            )
        elif result == "duplicate":
            _release_rate_slot(reserved_hour)
            reply = "这张图已经投过了"
            logger.info("submission result=duplicate image_path=%s", image_path)
        else:
            _release_rate_slot(reserved_hour)
            reply = f"投稿失败：{reason or '未知错误'}"
            logger.info(
                "submission result=error image_path=%s reason=%r",
                image_path,
                reason,
            )

        await _send_reply(gateway, event, reply)


def on_pre_gateway_dispatch(
    event: Any = None,
    gateway: Any = None,
    session_store: Any = None,
    **kwargs: Any,
) -> Optional[dict[str, str]]:
    """Handle QQ messages; all QQ traffic is consumed by this submission bot."""
    _log_dispatch_entry(event)
    try:
        platform_value = _platform_value(event)
        if platform_value != "qqbot":
            logger.info(
                "decision=continue reason=non-qqbot platform=%r",
                platform_value,
            )
            return None

        source = getattr(event, "source", None)
        if getattr(source, "chat_type", None) != "group":
            logger.info("decision=skip reason=qqbot-direct-message")
            return {"action": "skip", "reason": "qqbot-direct-message"}

        if not _is_bot_mentioned(event):
            logger.info("decision=silent reason=qqbot-not-mentioned")
            return {"action": "skip", "reason": "qqbot-not-mentioned"}

        text = str(getattr(event, "text", "") or "").strip()
        match = COMMAND_RE.match(text)
        if not match:
            logger.info("decision=silent reason=qqbot-non-submission")
            return {"action": "skip", "reason": "qqbot-non-submission"}

        title, character, parse_error, role_value = _parse_submission(
            text[match.end():]
        )
        if parse_error == "missing_both":
            logger.info("decision=parameter-error reason=missing-both")
            return _invalid_submission(gateway, event, "缺少标题和角色")
        if parse_error == "missing_title":
            logger.info("decision=parameter-error reason=missing-title")
            return _invalid_submission(gateway, event, "缺少标题")
        if parse_error == "missing_role":
            logger.info("decision=parameter-error reason=missing-role")
            return _invalid_submission(gateway, event, "缺少角色")
        if parse_error == "unknown_role":
            logger.info(
                "decision=parameter-error reason=unknown-role role=%r",
                role_value,
            )
            available = " / ".join(_character_ids())
            return _invalid_submission(
                gateway,
                event,
                f"角色「{role_value}」不存在，可用：{available}",
            )
        if len(title) > TITLE_MAX_LENGTH:
            logger.info(
                "decision=parameter-error reason=title-too-long title_length=%d",
                len(title),
            )
            return _invalid_submission(gateway, event, "标题太长")

        image_paths = _image_paths(event)
        if not image_paths:
            if _has_quoted_message(event):
                message = "只支持在同一条消息里附图，不支持引用或回复的图片"
                reason = "quoted-image"
            else:
                message = "缺少图片"
                reason = "missing-image"
            logger.info("decision=parameter-error reason=%s", reason)
            return _invalid_submission(gateway, event, message)

        remaining, limit, reset_label = _rate_status()
        if remaining <= 0:
            logger.info(
                "decision=quota-full limit=%d remaining=0 reset=%s image_count=%d",
                limit,
                reset_label,
                len(image_paths),
            )
            _schedule(
                _send_reply(
                    gateway,
                    event,
                    _quota_full_message(limit, reset_label),
                )
            )
            return {"action": "skip", "reason": "qqbot-hourly-limit"}

        token = os.environ.get("DAFEIYU_QQ_INBOUND_TOKEN", "").strip()
        if not token:
            logger.info(
                "decision=skip reason=qqbot-channel-not-configured missing=token"
            )
            _schedule(_send_reply(gateway, event, "投稿通道未配置"))
            return {"action": "skip", "reason": "qqbot-channel-not-configured"}

        url = os.environ.get("DAFEIYU_QQ_INBOUND_URL", DEFAULT_INBOUND_URL).strip()
        if not url:
            logger.info(
                "decision=skip reason=qqbot-channel-not-configured missing=url"
            )
            _schedule(_send_reply(gateway, event, "投稿通道未配置"))
            return {"action": "skip", "reason": "qqbot-channel-not-configured"}

        payload_base = {
            "groupId": str(getattr(source, "chat_id", "") or _raw_group_id(event)),
            "userId": str(getattr(source, "user_id", "") or _raw_user_id(event)),
            "messageId": str(getattr(event, "message_id", "") or ""),
            "name": title,
            "character": character,
        }
        _schedule(
            _process_submission(
                gateway=gateway,
                event=event,
                title=title,
                image_paths=image_paths,
                url=url,
                token=token,
                payload_base=payload_base,
            )
        )
        logger.info(
            "decision=submission-scheduled image_count=%d remaining_before=%d limit=%d",
            len(image_paths),
            remaining,
            limit,
        )
        return {"action": "skip", "reason": "qqbot-submission"}
    except Exception:
        logger.exception("qq submission hook failed")
        return {"action": "skip", "reason": "qqbot-submission-error"}


def register(ctx: Any) -> None:
    ctx.register_hook("pre_gateway_dispatch", on_pre_gateway_dispatch)
    logger.info("dafeiyu-qq-submission registered")
