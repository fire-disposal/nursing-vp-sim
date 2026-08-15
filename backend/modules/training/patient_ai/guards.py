"""Identity leak guard — prevents patient LLM from exposing its AI nature.

Phase 2 (T9)：误伤修复——黑名单只保留真正的 AI/系统术语；自然口语
（"继续问""你还想知道""你做得很好"等）从清单移除，避免整条重试。

判定规则：
- STRONG（AI 身份自曝）：命中任意 1 条即判泄漏；
- WEAK（系统/训练元语）：需命中 ≥2 条才判泄漏（单条可能是自然语境）。
"""

import logging

log = logging.getLogger(__name__)

_STRONG = [
    "我是ai",
    "我是人工智能",
    "我是ai助手",
    "我是虚拟患者",
    "作为ai",
    "作为人工智能",
    "作为一个ai",
    "此ai",
    "作为语言模型",
    "作为大模型",
    "我是大模型",
    "我是一个语言模型",
    "我是语言模型",
]

_WEAK = [
    "训练模式",
    "模拟训练",
    "角色扮演",
    "扮演患者",
    "token",
    "prompt",
    "system prompt",
    "评分标准",
    "测试数据",
]


def has_identity_leak(reply: str) -> bool:
    if not reply or not reply.strip():
        return False
    reply_lower = reply.lower()

    for pattern in _STRONG:
        if pattern in reply_lower:
            log.warning("身份泄露检测: strong pattern=%r triggered", pattern)
            return True

    weak_hits = [p for p in _WEAK if p in reply_lower]
    if len(weak_hits) >= 2:
        log.warning("身份泄露检测: weak patterns=%r triggered", weak_hits)
        return True
    return False


def get_identity_correction_note() -> str:
    return "【注意：你在扮演真实患者，你是人不是AI。用患者的语气自然回应，不要提及任何关于训练、评分、系统的内容。】"
