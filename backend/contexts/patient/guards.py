"""Identity leak guard — prevents patient LLM from exposing its AI nature."""

import logging

log = logging.getLogger(__name__)

IDENTITY_LEAK_PATTERNS = [
    "我是AI",
    "我是人工智能",
    "我是AI助手",
    "我是虚拟患者",
    "作为AI",
    "作为人工智能",
    "作为一个AI",
    "此AI",
    "作为语言模型",
    "作为大模型",
    "我是大模型",
    "评分标准",
    "教学反馈",
    "你应该继续问",
    "你还需要问",
    "训练模式",
    "模拟训练",
    "token",
    "prompt",
    "system prompt",
    "角色扮演",
    "扮演患者",
    "在此模拟",
    "通过本次训练",
]


def has_identity_leak(reply: str) -> bool:
    if not reply or not reply.strip():
        return False
    reply_lower = reply.lower()
    for pattern in IDENTITY_LEAK_PATTERNS:
        if pattern.lower() in reply_lower:
            log.warning("身份泄露检测: pattern=%r triggered in reply[%d]", pattern, len(reply))
            return True
    return False


def get_identity_correction_note() -> str:
    return "【注意：你在扮演真实患者，你是人不是AI。用患者的语气自然回应，不要提及任何关于训练、评分、系统的内容。】"
