"""四维情绪系统 — 渲染器。

将行为策略渲染为：
    1. 患者生成 Prompt Note（注入 LLM 上下文）
    2. TTS 语音策略（语速、音调等参数）
    3. 前端展示标签（dominant_state）
"""

from __future__ import annotations

from .behavior import PatientBehaviorPolicy
from .models import EmotionVector


def render_behavior_note(policy: PatientBehaviorPolicy) -> str:
    """将行为策略渲染为患者 Prompt 注入文本。

    不包含数值，只包含自然语言行为描述。
    """
    parts: list[str] = []

    parts.append(f"- 语气：{policy.tone}")
    parts.append(f"- 回答风格：{policy.response_style}")

    # 配合程度
    if policy.cooperation >= 0.7:
        parts.append("- 配合程度：愿意接受各项问诊和检查")
    elif policy.cooperation >= 0.4:
        parts.append("- 配合程度：愿意接受常规问诊和无创检查")
    else:
        parts.append("- 配合程度：对进一步检查持抵触态度，需要解释说服")

    # 拒绝风格
    if policy.refusal_style:
        parts.append(f"- 拒绝方式：{policy.refusal_style}")

    # 通用约束
    parts.append("- 行为边界：情绪只能影响表达方式，不得修改既定病史、症状、检查结果和病例事实")

    header = "【患者当前互动策略】"
    return header + "\n" + "\n".join(parts)


def resolve_dominant_state(vector: EmotionVector) -> str:
    """根据四维状态解析主导情绪标签。

    用于前端展示和 SSE 事件。
    """
    t, a, i, c = vector.trust, vector.anxiety, vector.irritation, vector.cooperation

    if t >= 0.7 and i <= 0.25 and a <= 0.4:
        return "open_trusting"
    if t >= 0.7 and a >= 0.6:
        return "trusting_anxious"
    if i >= 0.7:
        return "irritated"
    if a >= 0.7 and t >= 0.5:
        return "anxious_cooperative"
    if a >= 0.7:
        return "anxious_guarded"
    if t <= 0.3 and c <= 0.3:
        return "withdrawn"
    if t <= 0.3:
        return "defensive"
    if i <= 0.2 and a <= 0.3 and t >= 0.5:
        return "relaxed"

    return "neutral"


def derive_speech_policy(vector: EmotionVector) -> dict:
    """派生 TTS 语音参数策略。

    返回语速、音调、停顿等描述，由 TTS 层具体实现。
    """
    a = vector.anxiety
    i = vector.irritation
    t = vector.trust
    c = vector.cooperation

    # rate: 1.0 = normal, >1 = faster, <1 = slower
    rate = 1.0 + a * 0.15 + i * 0.10

    # pitch: 1.0 = normal
    pitch = 1.0 + a * 0.08 - t * 0.05

    # 停顿倾向：anxiety 高 → 更多停顿
    pause_tendency = clamp(a * 0.8 + i * 0.2)

    # 音量：trust 低 → 偏小
    volume = 1.0 - (1.0 - t) * 0.3

    return {
        "rate": round(rate, 2),
        "pitch": round(pitch, 2),
        "pause_tendency": round(pause_tendency, 2),
        "volume": round(volume, 2),
    }


def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))
