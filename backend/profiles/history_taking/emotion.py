"""患者情绪状态机 — 2D 信赖-舒适模型

信赖 (trust):    0-100  对护士专业能力的信任度
舒适 (comfort):  0-100  情感上的安全感和放松度

每轮 LLM 答复后通过情感分析产生 (trust_delta, comfort_delta) 双通道调整，
结果映射为 5 个显示标签（向后兼容 UI），并生成 Author's Note 注入 LLM prompt。
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from infrastructure.cache import EmotionCache

log = logging.getLogger(__name__)

# ── 显示标签映射 ──
# (信赖下限, 舒适下限) → 标签 → 描述
# FIRST match wins — order matters!
STATE_LABELS: list[tuple[tuple[int, int], str, str]] = [
    ((70, 70), "open", "开放信任，愿意详述"),
    ((30, 60), "relaxed", "放松配合，语气友好"),
    ((30, 35), "neutral", "正常配合"),
    ((30, 0), "anxious", "焦虑不安"),
    ((0, 30), "defensive", "防御抵触"),
    ((0, 0), "withdrawn", "沉默回避"),
]


def _lookup_state(trust: int, comfort: int) -> tuple[str, str]:
    best = ("neutral", "正常配合")
    for (t_min, c_min), label, desc in STATE_LABELS:
        if trust >= t_min and comfort >= c_min:
            return label, desc
    return best


# ── 状态对象 ──


@dataclass
class EmotionState:
    trust: int = 50
    comfort: int = 50
    history: list[dict] = field(default_factory=list)

    @property
    def state(self) -> str:
        label, _ = _lookup_state(self.trust, self.comfort)
        return label

    @property
    def note(self) -> str:
        return _build_author_note(self.trust, self.comfort)

    def update(self, dt: int, dc: int, intent_label: str = "") -> None:
        if dt == 0 and dc == 0:
            return
        old_trust, old_comfort = self.trust, self.comfort
        self.trust = max(0, min(100, self.trust + dt))
        self.comfort = max(0, min(100, self.comfort + dc))
        old_state = _lookup_state(old_trust, old_comfort)[0]
        new_state = _lookup_state(self.trust, self.comfort)[0]
        if old_state != new_state or dt != 0 or dc != 0:
            self.history.append(
                {
                    "trust": self.trust,
                    "comfort": self.comfort,
                    "state": new_state,
                    "intent": intent_label,
                    "timestamp": datetime.now(UTC).isoformat(),
                }
            )
            log.debug(
                "情绪变化: %s(t=%d,c=%d) → %s(t=%d,c=%d) [%s]",
                old_state,
                old_trust,
                old_comfort,
                new_state,
                self.trust,
                self.comfort,
                intent_label,
            )

    def to_dict(self) -> dict:
        return {"trust": self.trust, "comfort": self.comfort, "history": self.history}

    @classmethod
    def from_dict(cls, data: dict) -> EmotionState:
        return cls(
            trust=data.get("trust", 50),
            comfort=data.get("comfort", 50),
            history=data.get("history", []),
        )


def _build_author_note(trust: int, comfort: int) -> str:
    label, desc = _lookup_state(trust, comfort)
    parts = [f"信赖: {trust} | 舒适: {comfort}"]

    if trust < 30:
        parts.append("患者对护士专业能力存疑")
    elif trust < 60:
        parts.append("患者基本配合但保留")
    else:
        parts.append("患者信任护士的专业判断")

    if comfort < 30:
        parts.append("情绪紧张不安，回答简短回避")
    elif comfort < 60:
        parts.append("情绪平稳，按常规节奏交流")
    else:
        parts.append("心情放松，愿意开放交流")

    extra = {
        "withdrawn": "需要解释操作目的并表达真诚关心才能缓和",
        "defensive": "如果继续追问隐私而不解释原因，可能恶化",
        "anxious": "患者情绪焦虑，需要 reassurance 和耐心解释",
        "neutral": "患者保持一定距离，按真实感受回答",
        "relaxed": "患者心情放松，可能多聊一两句个人感受",
        "open": "患者对护士建立了信任，可能主动透露额外信息",
    }
    parts.append(extra.get(label, ""))

    return "【" + " | ".join(parts) + "】"


# ── 缓存 API（使用 EmotionCache + DB session） ──


_emotion_locks: dict[int, threading.Lock] = {}
_emotion_locks_guard = threading.Lock()


def get_emotion(record_id: int, cache: EmotionCache, db: Session) -> EmotionState:
    with _emotion_locks_guard:
        lock = _emotion_locks.get(record_id)
        if lock is None:
            lock = threading.Lock()
            _emotion_locks[record_id] = lock

    with lock:
        state = cache.get(record_id, db)
        if state is None or not isinstance(state, EmotionState):
            state = EmotionState()
            cache.set(record_id, state, db)
            db.flush()
        return state


def cleanup_emotion(record_id: int, cache: EmotionCache, db: Session) -> None:
    cache.cleanup(record_id, db)
    with _emotion_locks_guard:
        _emotion_locks.pop(record_id, None)
