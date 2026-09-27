"""DM 输出的**增量扫描**：从还没写完的 JSON 文本里，取出**已经完整**的顶层字段。

用途：单次结构化输出里包含多个内容块（叙述 / 台词 / 图片 / 选项 / 笔记），
"A 块写完、B 块还在写"时就能先把 A 块渲染出来——**展示可以增量，状态改动仍等完整回合校验后落地**。

只认顶层字段；值必须是**自身完整**的（字符串收尾、括号配平、字面量收尾）才算数，否则整块等下一批。
"""

from __future__ import annotations

import json
from typing import Any

_INCOMPLETE = object()


def _read_string(text: str, index: int) -> tuple[Any, int]:
    """从 `"` 开始读一个 JSON 字符串；未收尾 → 不完整。"""
    escaped = False
    position = index + 1
    while position < len(text):
        char = text[position]
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == '"':
            try:
                return json.loads(text[index : position + 1]), position + 1
            except json.JSONDecodeError:
                return _INCOMPLETE, len(text)
        position += 1
    return _INCOMPLETE, len(text)


def _read_container(text: str, index: int) -> tuple[Any, int]:
    """从 `{` / `[` 开始读一个容器；括号未配平 → 不完整。"""
    end = _container_end(text, index)
    if end is None:
        return _INCOMPLETE, len(text)
    try:
        return json.loads(text[index:end]), end
    except json.JSONDecodeError:
        return _INCOMPLETE, len(text)


def _container_end(text: str, index: int) -> int | None:
    """转义感知地找到容器收尾位置（返回收尾的下一位）；未配平返回 None。"""
    depth = 0
    in_string = False
    escaped = False
    for position in range(index, len(text)):
        char = text[position]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if in_string:
            in_string = char != '"'
            continue
        if char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
            if depth == 0:
                return position + 1
    return None


def _read_scalar(text: str, index: int) -> tuple[Any, int]:
    """数字 / true / false / null：**必须遇到分隔符**才算完整。

    尾随的裸数字（如 `"y": 12` 后面还没到）可能是被切断的（`123`），
    所以宁可等下一个分片，也不先渲染一个可能是错的数。
    """
    position = index
    while position < len(text) and text[position] not in ",}] \t\r\n":
        position += 1
    if position >= len(text):
        return _INCOMPLETE, len(text)
    fragment = text[index:position]
    if not fragment:
        return _INCOMPLETE, len(text)
    try:
        return json.loads(fragment), position
    except json.JSONDecodeError:
        return _INCOMPLETE, len(text)


def _read_value(text: str, index: int) -> tuple[Any, int]:
    if index >= len(text):
        return _INCOMPLETE, len(text)
    if text[index] == '"':
        return _read_string(text, index)
    if text[index] in "[{":
        return _read_container(text, index)
    return _read_scalar(text, index)


def _skip(text: str, index: int) -> int:
    while index < len(text) and text[index] in " \t\r\n,":
        index += 1
    return index


def _next_field(text: str, index: int) -> tuple[str, Any, int] | None:
    """读一对 `"key": value`；未读完 → None。"""
    index = _skip(text, index)
    if index >= len(text) or text[index] != '"':
        return None
    key, index = _read_string(text, index)
    if key is _INCOMPLETE or not isinstance(key, str):
        return None
    index = _skip_before(text, index)
    if index >= len(text) or text[index] != ":":
        return None
    value, index = _read_value(text, _skip(text, index + 1))
    if value is _INCOMPLETE:
        return None
    return key, value, index


def _skip_before(text: str, index: int) -> int:
    while index < len(text) and text[index] in " \t\r\n":
        index += 1
    return index


def scan_complete_fields(buffer: str) -> dict[str, Any]:
    """返回**已经完整**的顶层字段（未写完的字段直接跳过，不猜、不补）。"""
    start = buffer.find("{")
    if start == -1:
        return {}
    index = start + 1
    fields: dict[str, Any] = {}
    while index < len(buffer):
        step = _next_field(buffer, index)
        if step is None:
            break
        key, value, index = step
        fields[key] = value
    return fields


def fresh_fields(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """挑出相对上一批**新增或变化**的字段（流式推送用，避免重复推同一块）。"""
    return {key: value for key, value in current.items() if previous.get(key) != value}
