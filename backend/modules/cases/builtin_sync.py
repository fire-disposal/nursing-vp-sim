"""内置病例（``data/cases/*.json``）与数据库之间的内容收敛策略。

``data/cases/*.json`` 是内置病例的唯一权威副本，但已初始化的库不会因为仓库文件更新
而改变（``seed.py`` 过去只按 name 判重跳过），修复进不了老库。这里的纯函数让
``_seed_cases`` 每次启动都能把库里**未被教师改动**的行刷新到仓库版本。

判定依据是 ``case_data`` 里的 ``_seed_hash``。**注意它不是版本号**，而是「这一行当初
被写入时的内容指纹」（``content_hash`` 对去掉指纹键与元数据键后的 payload 做 sha256）。
用它与「当前内容的指纹」比对，才能区分三种行：

* 指纹缺失（历史行，或曾被旧写路径丢字段的坏行）→ 视为可覆盖。这是刻意的：旧库存量
  数据没有指纹，只有覆盖才能把仓库里的修复送达（顺带修好丢了 ``tools`` 的坏行）；
  「缺指纹」绝不等于「教师改过」，所以不会被当成教师改动而放行保留。
* 指纹存在且与当前内容一致 → 自种子以来未被改动，可覆盖为仓库版本。
* 指纹存在但与当前内容不符 → 教师已编辑，必须保留（绝不静默回滚教师的工作），仅打日志。
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from schemas.case_schema import strip_case_metadata

# 内容指纹的存储键；由 CaseDataSchema 的 extra="allow" 原样透传 CRUD 读写往返。
SEED_HASH_KEY = "_seed_hash"


def content_hash(case_data: dict[str, Any] | None) -> str:
    """Payload 的内容指纹（排除指纹键本身，避免自引用）。

    指纹按**剥离元数据后的内容**计算：``name``/``difficulty``/``time_limit`` 只存在于
    ``cases`` 列（docs/15 §六），不参与「内置内容是否被教师改过」的判定，否则列上的
    元数据变动会被误判成内容改动。

    指纹必须跨 JSONB 往返稳定，所以统一按 sort_keys 规范化后再哈希。
    """
    payload = strip_case_metadata({k: v for k, v in (case_data or {}).items() if k != SEED_HASH_KEY})
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def with_seed_bookmark(file_data: dict[str, Any]) -> dict[str, Any]:
    """落库 payload：仓库病例内容（剥离元数据键）+ 其内容指纹。"""
    payload = strip_case_metadata(file_data)
    return {**payload, SEED_HASH_KEY: content_hash(payload)}


def has_bookmark(case_data: dict[str, Any] | None) -> bool:
    """该行是否已带种子指纹（没有 = 历史行 / 被旧代码丢字段的行）。"""
    bookmark = (case_data or {}).get(SEED_HASH_KEY)
    return isinstance(bookmark, str) and bool(bookmark)


def same_content(case_data: dict[str, Any] | None, other: dict[str, Any] | None) -> bool:
    """两份 payload 的实质内容是否一致（忽略指纹键）。"""
    return content_hash(case_data) == content_hash(other)


def is_locally_edited(case_data: dict[str, Any] | None) -> bool:
    """仅当指纹存在且内容已与指纹不符时返回 True（= 教师改过，seed 必须让路）。

    没有指纹的行返回 False —— 它们交给 seed 用仓库版本收敛（修复旧库数据）。
    """
    if not has_bookmark(case_data):
        return False
    return content_hash(case_data) != (case_data or {})[SEED_HASH_KEY]
