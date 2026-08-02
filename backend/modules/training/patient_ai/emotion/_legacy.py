"""患者情绪状态机 — 2D 信赖-舒适模型 (v2: LLM-driven + personality-grounded)

信赖 (trust):    0-100  对护士专业能力的信任度
舒适 (comfort):  0-100  情感上的安全感和放松度

LLM 在生成回复时同轮输出结构化情感 delta。
PersonalityProfile 调制基线、反应幅度、衰减速率。
S 型信任曲线模拟真实的"筑墙→突破→天花板"。
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from modules.training.patient_ai.emotion_profile import PersonalityProfile
from modules.training.session.cache import EmotionCache

log = logging.getLogger(__name__)

# ── 状态标签：首次匹配，优先级从高到低 ──
# (trust_min, comfort_min) → (label, description)
_STATE_TABLE: list[tuple[int, int, str, str]] = [
    (70, 70, "open", "开放信任，愿意详述"),
    (30, 60, "relaxed", "放松配合，语气友好"),
    (30, 35, "neutral", "正常配合"),
    (30, 0, "anxious", "焦虑不安"),
    (0, 30, "defensive", "防御抵触"),
    (0, 0, "withdrawn", "沉默回避"),
]

MAX_HISTORY = 10


def _lookup_state(trust: int, comfort: int) -> tuple[str, str]:
    for t_min, c_min, label, desc in _STATE_TABLE:
        if trust >= t_min and comfort >= c_min:
            return label, desc
    return ("neutral", "正常配合")


def _s_curve(value: int, delta: int) -> int:
    """Apply S-curve modulation: delta effectiveness peaks at value=50, tapers at extremes.
    Uses round() instead of int() to prevent systematic truncation."""
    factor = 1.0 - abs(value - 50) / 50.0
    return round(delta * factor)


@dataclass
class EmotionState:
    trust: int = 50
    comfort: int = 50
    history: deque[dict] = field(default_factory=lambda: deque(maxlen=MAX_HISTORY))
    profile: PersonalityProfile = field(default_factory=PersonalityProfile)
    last_updated: datetime | None = None

    @property
    def state(self) -> str:
        label, _ = _lookup_state(self.trust, self.comfort)
        return label

    def apply_decay(self, now: datetime | None = None) -> None:
        """Regress trust/comfort toward baseline based on elapsed time since last update."""
        if self.last_updated is None:
            self.last_updated = datetime.now(UTC)
            return
        now = now or datetime.now(UTC)
        elapsed_minutes = (now - self.last_updated).total_seconds() / 60.0
        if elapsed_minutes < 0.1:
            return
        rate = self.profile.decay * elapsed_minutes
        old_t, old_c = self.trust, self.comfort
        self.trust = int(self.trust + rate * (self.profile.trust_base - self.trust))
        self.comfort = int(self.comfort + rate * (self.profile.comfort_base - self.comfort))
        self.trust = max(0, min(100, self.trust))
        self.comfort = max(0, min(100, self.comfort))
        if old_t != self.trust or old_c != self.comfort:
            log.debug("情绪衰减: t(%d→%d) c(%d→%d)", old_t, self.trust, old_c, self.comfort)
            self.last_updated = now

    def update(self, dt: int, dc: int, intent_label: str = "") -> None:
        """Apply personality-modulated, S-curve-gated deltas."""
        if dt == 0 and dc == 0:
            return

        dt, dc = self.profile.amplify(dt, dc)
        dt = _s_curve(self.trust, dt)
        dc = _s_curve(self.comfort, dc)

        old_trust, old_comfort = self.trust, self.comfort
        self.trust = max(0, min(100, self.trust + dt))
        self.comfort = max(0, min(100, self.comfort + dc))
        now = datetime.now(UTC)
        self.last_updated = now

        old_state = _lookup_state(old_trust, old_comfort)[0]
        new_state = _lookup_state(self.trust, self.comfort)[0]

        if old_state != new_state or dt != 0 or dc != 0:
            self.history.append(
                {
                    "trust": self.trust,
                    "comfort": self.comfort,
                    "state": new_state,
                    "intent": intent_label,
                    "timestamp": now.isoformat(),
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
        return {
            "trust": self.trust,
            "comfort": self.comfort,
            "history": list(self.history),
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
        }

    @classmethod
    def from_dict(cls, data: dict, profile: PersonalityProfile | None = None) -> EmotionState:
        hist = data.get("history", [])
        hist: deque[dict] = (
            deque(hist[-MAX_HISTORY:], maxlen=MAX_HISTORY) if isinstance(hist, list) else deque(maxlen=MAX_HISTORY)
        )
        ts_str: str | None = hist[-1]["timestamp"] if hist else data.get("last_updated")
        last_updated = datetime.fromisoformat(ts_str) if isinstance(ts_str, str) else None
        return cls(
            trust=data.get("trust", 50),
            comfort=data.get("comfort", 50),
            history=hist,
            profile=profile or PersonalityProfile(),
            last_updated=last_updated,
        )


# ── 缓存 API（与 v1 完全兼容） ──

_emotion_locks: dict[int, threading.Lock] = {}
_emotion_locks_guard = threading.Lock()


def get_emotion(
    record_id: int,
    cache: EmotionCache,
    db: Session,
    profile: PersonalityProfile | None = None,
) -> EmotionState:
    with _emotion_locks_guard:
        lock = _emotion_locks.get(record_id)
        if lock is None:
            lock = threading.Lock()
            _emotion_locks[record_id] = lock

    with lock:
        state = cache.get(record_id, db)
        if state is None or not isinstance(state, EmotionState):
            p = profile or PersonalityProfile()
            state = EmotionState(trust=p.trust_base, comfort=p.comfort_base, profile=p)
            cache.set(record_id, state, db)
            db.flush()
        elif profile is not None and state.profile.trust_base == 50 and profile.trust_base != 50:
            state.profile = profile
        return state


def cleanup_emotion(record_id: int, cache: EmotionCache, db: Session) -> None:
    cache.cleanup(record_id, db)
    with _emotion_locks_guard:
        _emotion_locks.pop(record_id, None)
