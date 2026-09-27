"""隐藏主题泄漏守卫 — 阻止患者主动吐出医生视角信息（出站检查）。

语义依据（modules/cases/prompts.py 字段说明）：
- hidden_info：学生问到了才可发现 → 不可硬拦（会破坏教学场景），仅提示词侧约束。
- deep_background：患者不会主动透露 → 可拦。其 dict 的**键**（如"吸烟史"、
  "职业"）是短而特异的理想守卫词。

守卫规则：
    泄漏 = reply 含 deep_background 键 且 学生**已问过**的内容未提及该键（asked 豁免）

``asked_text`` 必须是「学生迄今为止问过的全部内容」而不只是本轮：学生第 3 轮问过吸烟史、
患者第 5 轮又提到烟，那不叫"主动说出医生视角信息"。把豁免限制在本轮会产生**错误的泄漏判定**
→ 一次"你说漏了"的纠正重试，甚至压掉学生已经问到的信息（与 U0-A 通过条件
「学生合理追问能得到对应细节」直接冲突）。

已知边界（T7/PIP-13）：判定是**子串匹配**，不做语义等价——键「咯血」抓不到回复里的"血丝"。
修它需要作者可声明的别名或语义判定，属独立决策，不在本函数能力范围内。

与身份守卫（guards.py）同模式接入 llm_caller：命中 → 追加修正 system 消息重试。
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

# 过短的键（如单字）特异性不足，跳过，避免误伤。
HIDDEN_TOPIC_MIN_KEY_LEN = 2


def find_hidden_topic_leaks(reply: str, case_data: dict, asked_text: str = "") -> list[str]:
    """返回泄漏的 deep_background 主题键列表（空 = 无泄漏）。

    ``asked_text`` = 学生已经问过的内容（历史学生消息 + 本轮输入）；由调用方拼接。
    """
    if not reply or not reply.strip():
        return []
    deep_bg = case_data.get("deep_background") or {}
    if not isinstance(deep_bg, dict):
        return []

    reply_lower = reply.lower()
    asked_lower = (asked_text or "").lower()
    leaks: list[str] = []
    for key in deep_bg:
        k = str(key).strip()
        if len(k) < HIDDEN_TOPIC_MIN_KEY_LEN:
            continue
        k_lower = k.lower()
        if k_lower not in reply_lower:
            continue
        if k_lower in asked_lower:
            continue  # 学生问到了 → 患者可以答
        leaks.append(k)
    if leaks:
        log.warning("隐藏主题泄漏检测: topics=%r", leaks)
    return leaks


def get_hidden_topic_correction_note(leaks: list[str]) -> str:
    """重试用的修正指令——指出具体泄漏主题，要求患者视角重新回答。"""
    joined = "、".join(leaks)
    return (
        f"【注意：你刚才主动说出了患者并不知晓的诊断背景信息（{joined}）。"
        "作为患者你只知道自己身体的感觉，不知道医生视角的诊断结论。"
        "除非学生已经问到这个话题（含义上问到即可，不要求他说出原话），否则不要主动提及。"
        "用患者的语气重新回答。】"
    )
