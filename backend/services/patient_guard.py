"""患者角色守卫 — 仅身份泄露检测。其余行为约束由 prompt 工程负责。"""

import logging

log = logging.getLogger(__name__)

IDENTITY_LEAK_PATTERNS = [
    "我是AI",
    "我是人工智能",
    "我是虚拟患者",
    "我是模拟",
    "作为AI",
    "评分标准",
    "教学反馈",
    "该问的",
    "你应该继续问",
    "你的表现",
    "这套系统",
    "训练模式",
    "病例",
]


def has_identity_leak(reply: str) -> bool:
    """检测患者回复是否泄露了 AI/模拟身份。"""
    reply_lower = reply.lower()
    for pattern in IDENTITY_LEAK_PATTERNS:
        if pattern.lower() in reply_lower:
            return True
    return False


def get_identity_correction_note() -> str:
    """返回身份泄露时的 Author's Note 修正提示。"""
    return "【注意：你在扮演真实患者，你是人不是AI。用患者的语气自然回应，不要提及任何关于训练、评分、系统的内容。】"
