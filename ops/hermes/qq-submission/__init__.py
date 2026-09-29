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
FORMAT_HINT = "格式：@机器人 /投稿 标题 角色 + 图片"
COMMAND_RE = re.compile(r"^/投稿(?:\s+|$)")
CHARACTER_FILE = Path(__file__).with_name("characters.json")
ROLE_PREFIXES = ("角色:", "角色：")
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


def _parse_title_character(text: str) -> tuple[str, str]:
    body = text.strip()
    if not body:
        return "", ""

    parts = body.rsplit(maxsplit=1)
    if len(parts) != 2:
        return body, ""

    title, marker = parts[0].strip(), parts[1].strip()
    for prefix in ROLE_PREFIXES:
        if marker.startswith(prefix):
            value = marker[len(prefix):].strip()
            if value:
                canonical = _character_lookup().get(value.casefold(), value)
                return title, canonical

    canonical = _character_lookup().get(marker.casefold())
    if canonical:
        return title, canonical
    return body, ""


def _image_paths(event: Any) -> list[str]:
    media_urls = getattr(event, "media_urls", None)
    media_types = getattr(event, "media_types", None)
    if not isinstance(media_urls, (list, tuple)):
        return []
    if not isinstance(media_types, (list, tuple)):
        return []

    paths = []
    for path, media_type in zip(media_urls, media_types):
        if str(media_type or "").lower().startswith("image/"):
            paths.append(str(path))
    return paths


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

        title, character = _parse_title_character(text[match.end():])
        image_paths = _image_paths(event)
        if not title or not image_paths:
            _schedule(_send_reply(gateway, event, FORMAT_HINT))
            return {"action": "skip", "reason": "qqbot-invalid-submission"}

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