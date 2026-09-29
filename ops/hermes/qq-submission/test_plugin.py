from __future__ import annotations

import asyncio
import base64
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


PLUGIN_DIR = Path(__file__).resolve().parent
PLUGIN_NAME = "dafeiyu_qq_submission_under_test"
spec = importlib.util.spec_from_file_location(PLUGIN_NAME, PLUGIN_DIR / "__init__.py")
assert spec and spec.loader
plugin = importlib.util.module_from_spec(spec)
sys.modules[PLUGIN_NAME] = plugin
spec.loader.exec_module(plugin)


class Platform:
    def __init__(self, value: str) -> None:
        self.value = value


class FakeAdapter:
    def __init__(self) -> None:
        self.sent = []

    async def send(self, chat_id, text, reply_to=None):
        self.sent.append(
            {"chat_id": chat_id, "text": text, "reply_to": reply_to}
        )


class FakeGateway:
    def __init__(self, platform, adapter) -> None:
        self.adapters = {platform: adapter}


class FakeResponse:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def getcode(self) -> int:
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class PluginTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.image_path = Path(self.temp_dir.name) / "image.png"
        self.image_path.write_bytes(b"\x89PNG\r\n\x1a\npayload")
        self.qq_platform = Platform("qqbot")
        self.adapter = FakeAdapter()
        self.gateway = FakeGateway(self.qq_platform, self.adapter)

    def make_event(
        self,
        *,
        text: str = "/投稿 测试标题 deepseek",
        chat_type: str = "group",
        media_urls=None,
        media_types=None,
        platform=None,
        message_id: str = "msg-1",
        group_id: str = "group-1",
        user_id: str = "user-1",
    ):
        if media_urls is None:
            media_urls = [str(self.image_path)]
        if media_types is None:
            media_types = ["image/png"] if media_urls else []
        source = SimpleNamespace(
            platform=platform or self.qq_platform,
            chat_type=chat_type,
            chat_id=group_id,
            user_id=user_id,
        )
        return SimpleNamespace(
            text=text,
            message_id=message_id,
            media_urls=media_urls,
            media_types=media_types,
            source=source,
            raw_message={
                "group_openid": group_id,
                "author": {"member_openid": user_id},
            },
        )

    def dispatch(self, event):
        async def run():
            result = plugin.on_pre_gateway_dispatch(
                event=event,
                gateway=self.gateway,
            )
            tasks = [
                task
                for task in asyncio.all_tasks()
                if task is not asyncio.current_task()
            ]
            if tasks:
                await asyncio.gather(*tasks)
            return result

        return asyncio.run(run())

    def env(self, **values):
        return patch.dict(os.environ, values, clear=True)

    def fake_urlopen(self, status: int, body: bytes):
        calls = []

        def urlopen(request, timeout=None):
            calls.append({"request": request, "timeout": timeout})
            return FakeResponse(status, body)

        return urlopen, calls

    def test_non_qqbot_returns_none(self) -> None:
        event = self.make_event(platform=Platform("telegram"))
        with self.env(DAFEIYU_QQ_INBOUND_TOKEN="token"):
            result = self.dispatch(event)

        self.assertIsNone(result)
        self.assertEqual(self.adapter.sent, [])

    def test_private_message_is_skipped_without_reply(self) -> None:
        event = self.make_event(chat_type="dm")
        with self.env(DAFEIYU_QQ_INBOUND_TOKEN="token"):
            result = self.dispatch(event)

        self.assertEqual(result, {"action": "skip", "reason": "qqbot-direct-message"})
        self.assertEqual(self.adapter.sent, [])

    def test_group_message_without_command_is_skipped_without_post(self) -> None:
        event = self.make_event(text="普通聊天")
        fake_urlopen, calls = self.fake_urlopen(202, b'{"ok":true}')
        with self.env(DAFEIYU_QQ_INBOUND_TOKEN="token"), patch(
            "urllib.request.urlopen", side_effect=fake_urlopen
        ):
            result = self.dispatch(event)

        self.assertEqual(result, {"action": "skip", "reason": "qqbot-non-submission"})
        self.assertEqual(calls, [])
        self.assertEqual(self.adapter.sent, [])

    def test_missing_image_replies_with_format_hint(self) -> None:
        event = self.make_event(text="/投稿 测试标题 deepseek", media_urls=[])
        fake_urlopen, calls = self.fake_urlopen(202, b'{"ok":true}')
        with self.env(DAFEIYU_QQ_INBOUND_TOKEN="token"), patch(
            "urllib.request.urlopen", side_effect=fake_urlopen
        ):
            result = self.dispatch(event)

        self.assertEqual(
            result,
            {"action": "skip", "reason": "qqbot-invalid-submission"},
        )
        self.assertEqual(calls, [])
        self.assertEqual(
            self.adapter.sent,
            [
                {
                    "chat_id": "group-1",
                    "text": plugin.FORMAT_HINT,
                    "reply_to": "msg-1",
                }
            ],
        )

    def test_title_and_character_alias_are_posted_in_payload(self) -> None:
        event = self.make_event(text="/投稿 Hermes 测试 蓝色大肥鱼")
        fake_urlopen, calls = self.fake_urlopen(202, b'{"ok":true}')
        with self.env(
            DAFEIYU_QQ_INBOUND_TOKEN="secret-token",
            DAFEIYU_QQ_INBOUND_URL="https://example.test/qq-events",
        ), patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = self.dispatch(event)

        self.assertEqual(result, {"action": "skip", "reason": "qqbot-submission"})
        self.assertEqual(len(calls), 1)
        request = calls[0]["request"]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(request.full_url, "https://example.test/qq-events")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret-token")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(calls[0]["timeout"], 20)
        self.assertEqual(payload["groupId"], "group-1")
        self.assertEqual(payload["userId"], "user-1")
        self.assertEqual(payload["messageId"], "msg-1")
        self.assertEqual(payload["name"], "Hermes 测试")
        self.assertEqual(payload["character"], "deepseek")
        self.assertEqual(
            base64.b64decode(payload["image"]["base64"]),
            self.image_path.read_bytes(),
        )
        self.assertEqual(
            self.adapter.sent[0]["text"],
            "已收到投稿《Hermes 测试》，审核结果会稍后公布",
        )

    def test_duplicate_response_replies_already_submitted(self) -> None:
        event = self.make_event()
        fake_urlopen, calls = self.fake_urlopen(
            200,
            b'{"ok":true,"id":"sub_1","status":"received"}',
        )
        with self.env(DAFEIYU_QQ_INBOUND_TOKEN="token"), patch(
            "urllib.request.urlopen", side_effect=fake_urlopen
        ):
            self.dispatch(event)

        self.assertEqual(len(calls), 1)
        self.assertEqual(self.adapter.sent[0]["text"], "这张图已经投过了")

    def test_error_response_replies_short_reason(self) -> None:
        event = self.make_event()
        error = urllib.error.HTTPError(
            "https://example.test/qq-events",
            400,
            "Bad Request",
            {},
            io.BytesIO(b'{"ok":false,"error":"invalid_image"}'),
        )

        def urlopen(request, timeout=None):
            raise error

        with self.env(DAFEIYU_QQ_INBOUND_TOKEN="token"), patch(
            "urllib.request.urlopen", side_effect=urlopen
        ):
            self.dispatch(event)

        self.assertEqual(self.adapter.sent[0]["text"], "投稿失败：invalid_image")

    def test_missing_token_replies_not_configured_without_post(self) -> None:
        event = self.make_event()
        fake_urlopen, calls = self.fake_urlopen(202, b'{"ok":true}')
        with self.env(
            DAFEIYU_QQ_INBOUND_URL="https://example.test/qq-events"
        ), patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = self.dispatch(event)

        self.assertEqual(
            result,
            {"action": "skip", "reason": "qqbot-channel-not-configured"},
        )
        self.assertEqual(calls, [])
        self.assertEqual(self.adapter.sent[0]["text"], "投稿通道未配置")

    def test_multiple_images_post_one_request_each_with_same_message_id(self) -> None:
        second_image = Path(self.temp_dir.name) / "second.png"
        second_image.write_bytes(b"\x89PNG\r\n\x1a\nsecond")
        event = self.make_event(
            media_urls=[str(self.image_path), str(second_image)],
            media_types=["image/png", "image/jpeg"],
        )
        fake_urlopen, calls = self.fake_urlopen(202, b'{"ok":true}')
        with self.env(DAFEIYU_QQ_INBOUND_TOKEN="token"), patch(
            "urllib.request.urlopen", side_effect=fake_urlopen
        ):
            self.dispatch(event)

        payloads = [
            json.loads(call["request"].data.decode("utf-8")) for call in calls
        ]
        self.assertEqual(len(payloads), 2)
        self.assertEqual(payloads[0]["messageId"], "msg-1")
        self.assertEqual(payloads[1]["messageId"], "msg-1")


if __name__ == "__main__":
    unittest.main()