"""Per-turn 患者状态消息 — 情绪策略 / 操作注记 / 场景状态合成一条 system 消息。

替代旧 trailing Author's Note：内容来源相同（NoteCollector 产物 + SceneState），
但固定头部、结构化分节、置于 user 输入之前——语义是"患者此刻的事实 → 学生的话
→ 患者的回应"，且与静态前缀隔离。
"""

from __future__ import annotations

PATIENT_STATE_HEADER = "【患者当前状态 — 以下为患者此刻的实时事实，仅本轮生效】"


def build_patient_state(*, scene_text: str = "", note_text: str = "") -> str:
    """合成每轮状态消息；无任何内容时返回空串（调用方跳过该消息）。"""
    sections: list[str] = []
    if note_text and note_text.strip():
        sections.append(note_text.strip())
    if scene_text and scene_text.strip():
        sections.append(scene_text.strip())
    if not sections:
        return ""
    return PATIENT_STATE_HEADER + "\n" + "\n\n".join(sections)
