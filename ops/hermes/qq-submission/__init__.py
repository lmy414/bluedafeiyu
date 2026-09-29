"""Hermes QQ group submission hook for bluedafeiyu."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_INBOUND_URL = (
    "https://xn--pssy23gqgbz2d718b.com/api/v1/adapters/qq/events"
)
FORMAT_HINT = "格式：@机器人 投稿 标题 角色 + 图片（例：@机器人 投稿 早安 deepseek）"
COMMAND_RE = re.compile(r"^/?投稿(?:\s+|\Z)")
CHARACTER_FILE = Path(__file__).with_name("characters.json")
ROLE_PREFIXES = ("角色:", "角色：")
TITLE_MAX_LENGTH = 64
ERROR_REASON_MAX = 120


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


def _resolve_character(marker: str) -> tuple[str, str]:
    """Return (user-facing role value, canonical id or empty)."""
    value = marker.strip()
    for prefix in ROLE_PREFIXES:
        if value.startswith(prefix):
            value = value[len(prefix):].strip()
            break

    canonical = _character_lookup().get(value.casefold(), "")
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
    try:
        source = event.source
        adapter = gateway.adapters.get(source.platform)
        if adapter is None:
            logger.error("qq adapter not found for platform %r", source.platform)
            return
        await adapter.send(source.chat_id, text, reply_to=event.message_id)
    except Exception:
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
    for image_path in image_paths:
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
            reply = f"已收到投稿《{title}》，审核结果会稍后公布"
        elif result == "duplicate":
            reply = "这张图已经投过了"
        else:
            reply = f"投稿失败：{reason or '未知错误'}"

        await _send_reply(gateway, event, reply)


def on_pre_gateway_dispatch(
    event: Any = None,
    gateway: Any = None,
    session_store: Any = None,
    **kwargs: Any,
) -> Optional[dict[str, str]]:
    """Handle QQ messages; all QQ traffic is consumed by this submission bot."""
    try:
        if _platform_value(event) != "qqbot":
            return None

        source = getattr(event, "source", None)
        if getattr(source, "chat_type", None) != "group":
            return {"action": "skip", "reason": "qqbot-direct-message"}

        text = str(getattr(event, "text", "") or "").strip()
        match = COMMAND_RE.match(text)
        if not match:
            return {"action": "skip", "reason": "qqbot-non-submission"}

        title, character, parse_error, role_value = _parse_submission(
            text[match.end():]
        )
        if parse_error == "missing_both":
            return _invalid_submission(gateway, event, "缺少标题和角色")
        if parse_error == "missing_title":
            return _invalid_submission(gateway, event, "缺少标题")
        if parse_error == "missing_role":
            return _invalid_submission(gateway, event, "缺少角色")
        if parse_error == "unknown_role":
            available = " / ".join(_character_ids())
            return _invalid_submission(
                gateway,
                event,
                f"角色「{role_value}」不存在，可用：{available}",
            )
        if len(title) > TITLE_MAX_LENGTH:
            return _invalid_submission(gateway, event, "标题太长")

        image_paths = _image_paths(event)
        if not image_paths:
            if _has_quoted_message(event):
                message = "只支持在同一条消息里附图，不支持引用或回复的图片"
            else:
                message = "缺少图片"
            return _invalid_submission(gateway, event, message)

        token = os.environ.get("DAFEIYU_QQ_INBOUND_TOKEN", "").strip()
        if not token:
            _schedule(_send_reply(gateway, event, "投稿通道未配置"))
            return {"action": "skip", "reason": "qqbot-channel-not-configured"}

        url = os.environ.get("DAFEIYU_QQ_INBOUND_URL", DEFAULT_INBOUND_URL).strip()
        if not url:
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
        return {"action": "skip", "reason": "qqbot-submission"}
    except Exception:
        logger.exception("qq submission hook failed")
        return {"action": "skip", "reason": "qqbot-submission-error"}


def register(ctx: Any) -> None:
    ctx.register_hook("pre_gateway_dispatch", on_pre_gateway_dispatch)
