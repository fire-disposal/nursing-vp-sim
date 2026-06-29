"""Virtual patient chat messages builder — assembles LLM messages array."""

import logging

log = logging.getLogger(__name__)

from infrastructure.prompt import render_template
from prompts.patient_chat import AUTHOR_NOTE_TEMPLATE


def build_patient_chat_messages(
    system_prompt: str,
    dynamic_prompt: str,
    history_messages: list,
    student_content: str,
    author_note: str = "",
    max_rounds: int = 8,
) -> list[dict]:
    """构建 AI酒馆风格的 messages 数组。

    结构：
      messages[0] = Character Card (静态, prefix cache)
      messages[1] = 患者资料+背景+示例 (per-session)
      messages[2..N] = 聊天历史
      messages[-2] = 用户输入
      messages[-1] = Author's Note (系统消息, 放在用户输入之后，提升 KV cache 命中率)
    """
    llm_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": dynamic_prompt},
    ]

    for msg in history_messages[-max_rounds * 2 :]:
        if msg.role == "system":
            continue
        role = "user" if msg.role == "student" else "assistant"
        llm_messages.append({"role": role, "content": msg.content})

    llm_messages.append({"role": "user", "content": student_content})

    if author_note.strip():
        note_content = render_template(AUTHOR_NOTE_TEMPLATE, author_note=author_note)
        llm_messages.append({"role": "system", "content": note_content})

    return llm_messages
