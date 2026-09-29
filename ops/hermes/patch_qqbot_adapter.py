#!/usr/bin/env python3
"""为 Hermes QQ 适配器补齐本地补丁。"""

import argparse
import datetime
import os
import py_compile
import stat
import sys
import tempfile

DEFAULT_TARGET = "/opt/hermes/gateway/platforms/qqbot/adapter.py"

DISPATCH_ANCHOR = '                    "GROUP_AT_MESSAGE_CREATE",'
DISPATCH_INSERT = (
    '                    "GROUP_MESSAGE_CREATE",'
    "  # local patch 2026-09-29: full group messages"
)
DISPATCH_MARKER = '"GROUP_MESSAGE_CREATE"'
EVENT_ANCHOR = '        elif event_type in {"GROUP_AT_MESSAGE_CREATE",}:'
EVENT_PATCHED = (
    '        elif event_type in {"GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"}:'
    "  # local patch 2026-09-29"
)
MENTION_ANCHOR = r'        stripped = re.sub(r"^@\S+\s*", "", content.strip())'
MENTION_PATCHED = (
    r'        stripped = re.sub(r"^(?:<@!?[^>]+>|@\S+)\s*", "", content.strip())'
    "  # local patch 2026-09-29: <@openid>"
)


def _line_body(line):
    return line.rstrip("\r\n")


def _line_ending(line):
    if line.endswith("\r\n"):
        return "\r\n"
    if line.endswith("\n"):
        return "\n"
    if line.endswith("\r"):
        return "\r"
    return ""


def _default_newline(text):
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def _find_dispatch_region(lines):
    regions = []
    for start, line in enumerate(lines):
        if _line_body(line).strip() != "elif t in {":
            continue

        end = start + 1
        while end < len(lines):
            if _line_body(lines[end]).strip().startswith("}"):
                break
            end += 1
        if end >= len(lines):
            continue

        if any(
            '"C2C_MESSAGE_CREATE"' in _line_body(item)
            for item in lines[start + 1:end]
        ):
            regions.append((start, end))
    return regions


def _dispatch_change(lines):
    regions = _find_dispatch_region(lines)
    if len(regions) != 1:
        return None, (
            '第1处补丁锚点不匹配：应找到 1 个含 "C2C_MESSAGE_CREATE" 的 '
            f"elif t in {{ 分发集合，实际找到 {len(regions)} 个。"
        )

    start, end = regions[0]
    if any(DISPATCH_MARKER in _line_body(item) for item in lines[start + 1:end]):
        return None, None

    matches = [
        index
        for index in range(start + 1, end)
        if _line_body(lines[index]) == DISPATCH_ANCHOR
    ]
    if len(matches) != 1:
        return None, (
            "第1处补丁锚点不匹配：分发集合内应恰好有 1 行 "
            f"{DISPATCH_ANCHOR!r}，实际找到 {len(matches)} 行。"
        )
    return ("insert", matches[0], DISPATCH_INSERT), None


def _replace_change(lines, label, anchor, patched):
    if any(_line_body(line) == patched for line in lines):
        return None, None

    matches = [
        index for index, line in enumerate(lines) if _line_body(line) == anchor
    ]
    if len(matches) != 1:
        return None, (
            f"{label}补丁锚点不匹配：应恰好有 1 行 {anchor!r}，"
            f"实际找到 {len(matches)} 行。"
        )
    return ("replace", matches[0], patched), None


def _atomic_write(path, data, mode):
    directory = os.path.dirname(os.path.abspath(path))
    basename = os.path.basename(path)
    fd, temporary = tempfile.mkstemp(
        prefix="." + basename + ".", suffix=".tmp", dir=directory
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _create_backup(path, data, mode):
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    backup = f"{path}.orig-{stamp}"
    try:
        with open(backup, "xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(backup, mode)
    except Exception:
        try:
            os.unlink(backup)
        except OSError:
            pass
        raise
    return backup


def _compile(path):
    fd, compiled = tempfile.mkstemp(prefix="qqbot-adapter-", suffix=".pyc")
    os.close(fd)
    try:
        py_compile.compile(path, cfile=compiled, doraise=True)
    finally:
        try:
            os.unlink(compiled)
        except OSError:
            pass


def _apply_changes(lines, changes, default_newline):
    for change in sorted(changes, key=lambda item: item[1], reverse=True):
        if change[0] == "insert":
            _, index, text = change
            ending = _line_ending(lines[index])
            if ending:
                lines.insert(index + 1, text + ending)
            else:
                lines[index] = lines[index] + default_newline
                lines.insert(index + 1, text)
        else:
            _, index, text = change
            lines[index] = text + _line_ending(lines[index])
    return lines


def main(argv=None):
    parser = argparse.ArgumentParser(description="为 Hermes QQ 适配器补齐本地补丁")
    parser.add_argument(
        "target",
        nargs="?",
        default=DEFAULT_TARGET,
        help="adapter.py 路径（默认容器内路径）",
    )
    parser.add_argument("--check", action="store_true", help="只检查，不写文件")
    args = parser.parse_args(argv)

    target = os.path.abspath(args.target)
    try:
        with open(target, "rb") as handle:
            original_bytes = handle.read()
        mode = stat.S_IMODE(os.stat(target).st_mode)
    except OSError as exc:
        print(f"读取失败：{target}：{exc}", file=sys.stderr)
        return 2

    try:
        text = original_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        print(f"读取失败：目标不是 UTF-8：{exc}", file=sys.stderr)
        return 2

    lines = text.splitlines(keepends=True)
    changes = []
    errors = []

    change, error = _dispatch_change(lines)
    if error:
        errors.append(error)
    elif change:
        changes.append(change)

    change, error = _replace_change(lines, "第2处", EVENT_ANCHOR, EVENT_PATCHED)
    if error:
        errors.append(error)
    elif change:
        changes.append(change)

    change, error = _replace_change(
        lines, "第3处", MENTION_ANCHOR, MENTION_PATCHED
    )
    if error:
        errors.append(error)
    elif change:
        changes.append(change)

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 2

    if not changes:
        return 0

    if args.check:
        print(f"--check：检测到 {len(changes)} 处待应用补丁，未写入文件。")
        return 1

    updated_lines = _apply_changes(
        list(lines), changes, _default_newline(text)
    )
    updated_bytes = "".join(updated_lines).encode("utf-8")

    try:
        backup = _create_backup(target, original_bytes, mode)
    except Exception as exc:
        print(f"备份失败：{exc}", file=sys.stderr)
        return 2

    try:
        _atomic_write(target, updated_bytes, mode)
    except Exception as exc:
        print(f"写入失败：{exc}", file=sys.stderr)
        return 2

    try:
        _compile(target)
    except Exception as exc:
        print(f"py_compile 失败：{exc}", file=sys.stderr)
        try:
            with open(backup, "rb") as handle:
                restored = handle.read()
            _atomic_write(target, restored, mode)
        except Exception as restore_exc:
            print(f"从备份恢复失败：{restore_exc}", file=sys.stderr)
        else:
            print(f"已从备份恢复：{backup}", file=sys.stderr)
        return 2

    print(f"已打补丁并通过 py_compile 校验：{target}；备份：{backup}")
    return 10


if __name__ == "__main__":
    sys.exit(main())