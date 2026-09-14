"""官方 DeepSeek tokenizer 适配 —— 惰性单例 + LRU 缓存 + 文档化降级。

产物 ``backend/data/tokenizer/tokenizer.json`` 取自官方
``https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip``（未改动的 ``tokenizer.json``，
6.1 MB），随 ``backend/data/`` 入库 —— 与 ``data/textbooks`` 同一约定。

**为何入库而非构建期下载**：该 zip 没有版本号、没有校验和，构建期拉取等于让每次镜像构建
跟随上游漂移，token 口径也随之不可复现；而 tokenizer 必须与模型版本一一对应，精确字节
本身就是正确性属性。代价是仓库 +6.1 MB（gzip 后 1.9 MB），且换模型要显式提交一次产物。

**口径**（2026-09-14 校准，120 条 staging 真实 ``llm_call_logs``，见
``token_counter.estimate_tokens``）：本模块的编码结果与 API ``prompt_tokens`` 的差值
恒为负且按用途近似恒定 —— emotion_analysis −4~−3、patient_chat −50~−3（随消息条数
变化）、scoring −102。那是 ``request_text`` 之外的部分（``client.py`` 用
``" ".join(content)`` 拼接，不含 role 标记；scoring 的 −102 是 ``response_format``
JSON schema 注入，作为独立 payload 字段发送），属预期口径差，不是编码错误。

**降级（非静默）**：``tokenizers`` 未安装，或产物缺失/损坏时，``count_tokens`` 返回
``None`` 由调用方回退到字符比例估算；同时打带原因的 warning 日志，并用 ``tokenizer_status()``
暴露当前口径与 ``fallback_calls`` 计数（供 metrics/诊断接线；本模块不反向依赖 metrics）。
加载只探测一次，失败后不再重试（避免每次调用都去 stat 文件系统）。
"""

from __future__ import annotations

import functools
import logging
import threading
from pathlib import Path

log = logging.getLogger(__name__)

# 产物路径：backend/data/tokenizer/tokenizer.json
ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "data" / "tokenizer" / "tokenizer.json"

# LRU 条数上限。键是原文，命中来自**跨轮重复**的历史消息行（历史裁剪每轮重算同一批
# 文本）。整段 prompt 每次不同，故超过 _CACHE_MAX_TEXT_CHARS 的文本直接跳过缓存 ——
# 否则一次性的大字符串会把真正复用的小文本冲掉。
_CACHE_ENTRIES = 2048
_CACHE_MAX_TEXT_CHARS = 512

# 降级日志心跳间隔：探测失败时打一条带原因的 warning，#1 之后每 N 次调用再提醒一次，
# 以便长时间运行仍能发现「一直在降级」，又不至于在热路径刷屏。
_FALLBACK_LOG_EVERY = 10_000

_load_lock = threading.Lock()
_load_probed = False
_tokenizer = None
_load_error: str | None = None
_fallback_calls = 0


def _load():
    """惰性加载单例；失败返回 ``None`` 并记住原因（只探测一次）。"""
    global _load_probed, _tokenizer, _load_error
    if _load_probed:
        return _tokenizer
    with _load_lock:
        if _load_probed:
            return _tokenizer
        try:
            from tokenizers import Tokenizer
        except ImportError as exc:
            _load_error = f"tokenizers 未安装 ({exc})"
        else:
            try:
                _tokenizer = Tokenizer.from_file(str(ARTIFACT_PATH))
            except Exception as exc:
                _load_error = f"tokenizer 产物不可用 ({ARTIFACT_PATH}): {exc}"
        _load_probed = True
        if _tokenizer is None:
            log.warning("官方 tokenizer 不可用，token 计数降级为字符比例估算：%s", _load_error)
        return _tokenizer


def _note_fallback() -> None:
    """记一次降级调用（计数 + 心跳日志）。"""
    global _fallback_calls
    _fallback_calls += 1
    if _fallback_calls % _FALLBACK_LOG_EVERY == 1:
        log.warning("token 计数降级中（第 %d 次）：%s", _fallback_calls, _load_error)


@functools.lru_cache(maxsize=_CACHE_ENTRIES)
def _encode_count(text: str) -> int:
    """编码并计数（走 LRU）。仅在 ``_load()`` 成功时被调用，见 ``count_tokens``。"""
    return len(_load().encode(text, add_special_tokens=False).ids)


def count_tokens(text: str) -> int | None:
    """官方 tokenizer 计数；不可用时返回 ``None``（调用方据此决定降级口径）。

    ``add_special_tokens=False``：产物 ``tokenizer_config.json`` 关掉了 BOS/EOS 后处理，
    显式关闭只是把「不含特殊 token」写成不变式 —— 两种取值实测结果一致，而 chat 模板
    开销属于 API 侧 ``prompt_tokens`` 的口径，不该由这里补。
    """
    if not text:
        return 0
    tokenizer = _load()
    if tokenizer is None:
        _note_fallback()
        return None
    if len(text) > _CACHE_MAX_TEXT_CHARS:
        return len(tokenizer.encode(text, add_special_tokens=False).ids)
    return _encode_count(text)


def is_available() -> bool:
    """官方 tokenizer 是否可用（会触发一次加载探测）。"""
    return _load() is not None


def tokenizer_status() -> dict:
    """降级观测快照（无副作用：不触发加载）。

    ``mode``：``tokenizer`` 已就绪 / ``heuristic`` 已降级 / ``unloaded`` 尚未用到。
    """
    if not _load_probed:
        mode = "unloaded"
    elif _tokenizer is None:
        mode = "heuristic"
    else:
        mode = "tokenizer"
    return {
        "mode": mode,
        "fallback_calls": _fallback_calls,
        "cache_entries": _encode_count.cache_info().currsize,
        "error": _load_error,
    }
