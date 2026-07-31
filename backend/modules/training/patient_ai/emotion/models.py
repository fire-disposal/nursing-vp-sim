"""四维情绪系统 — 核心数据类型。

EmotionVector:  当前四维状态 (trust, anxiety, irritation, cooperation)
EmotionDelta:   单次变化量
EmotionState:   带版本的持久化状态
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime


def clamp01(value: float) -> float:
    """Clamp value to [0.0, 1.0]."""
    return max(0.0, min(1.0, value))


@dataclass(frozen=True, slots=True)
class EmotionDelta:
    """单次情绪变化量，四维独立。

    正值 = 增加该维度（如 trust+0.05 = 更信任）。
    负值 = 降低该维度（如 anxiety-0.05 = 更放松）。
    """

    trust: float = 0.0
    anxiety: float = 0.0
    irritation: float = 0.0
    cooperation: float = 0.0

    def scaled(self, factor: float) -> EmotionDelta:
        """按因子缩放所有维度。

        用于置信度调整、人格敏感度调制等。
        """
        return EmotionDelta(
            trust=self.trust * factor,
            anxiety=self.anxiety * factor,
            irritation=self.irritation * factor,
            cooperation=self.cooperation * factor,
        )

    def __add__(self, other: EmotionDelta) -> EmotionDelta:
        return EmotionDelta(
            trust=self.trust + other.trust,
            anxiety=self.anxiety + other.anxiety,
            irritation=self.irritation + other.irritation,
            cooperation=self.cooperation + other.cooperation,
        )

    def is_zero(self) -> bool:
        return self.trust == 0.0 and self.anxiety == 0.0 and self.irritation == 0.0 and self.cooperation == 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "trust": self.trust,
            "anxiety": self.anxiety,
            "irritation": self.irritation,
            "cooperation": self.cooperation,
        }


@dataclass(slots=True)
class EmotionVector:
    """四维情绪状态，全部 [0.0, 1.0]。

    trust:        信任程度 — 患者是否相信医护人员
    anxiety:      焦虑程度 — 对疾病、不确定性的担忧
    irritation:   烦躁程度 — 因冒犯、重复询问等产生的抵触
    cooperation:  配合意愿 — 患者愿意参与问诊、检查的程度

    四个维度互相独立，不通过公式强制推导。
    高信任+高焦虑 = 信任护士但仍担心病情。
    低信任+高配合 = 虽有戒备但因就医需求仍回答问题。
    """

    trust: float
    anxiety: float
    irritation: float
    cooperation: float

    def apply(self, delta: EmotionDelta) -> EmotionVector:
        """应用 delta 并钳制到 [0,1]."""
        return EmotionVector(
            trust=clamp01(self.trust + delta.trust),
            anxiety=clamp01(self.anxiety + delta.anxiety),
            irritation=clamp01(self.irritation + delta.irritation),
            cooperation=clamp01(self.cooperation + delta.cooperation),
        )

    def to_dict(self) -> dict[str, float]:
        return {
            "trust": self.trust,
            "anxiety": self.anxiety,
            "irritation": self.irritation,
            "cooperation": self.cooperation,
        }

    @classmethod
    def from_dict(cls, data: dict) -> EmotionVector:
        return cls(
            trust=float(data.get("trust", 0.5)),
            anxiety=float(data.get("anxiety", 0.5)),
            irritation=float(data.get("irritation", 0.5)),
            cooperation=float(data.get("cooperation", 0.5)),
        )

    @classmethod
    def neutral(cls) -> EmotionVector:
        """中性起始状态。"""
        return cls(trust=0.50, anxiety=0.50, irritation=0.35, cooperation=0.50)


@dataclass(slots=True)
class EmotionState:
    """带版本号的持久化情绪状态。

    version 用于乐观锁并发控制。
    last_turn_id 防止同一轮事件重复应用。
    """

    vector: EmotionVector
    version: int = 1
    last_turn_id: str | None = None
    updated_at: datetime | None = None

    @classmethod
    def initial(cls, vector: EmotionVector | None = None) -> EmotionState:
        return cls(
            vector=vector or EmotionVector.neutral(),
            version=1,
            updated_at=datetime.now(UTC),
        )

    def apply(self, delta: EmotionDelta, turn_id: str) -> EmotionState:
        """应用 delta，返回新状态（不修改 self）。

        turn_id 为当前轮次标识，记录到 last_turn_id 防止重复应用。
        """
        return EmotionState(
            vector=self.vector.apply(delta),
            version=self.version + 1,
            last_turn_id=turn_id,
            updated_at=datetime.now(UTC),
        )

    def to_dict(self) -> dict:
        return {
            "vector": self.vector.to_dict(),
            "version": self.version,
            "last_turn_id": self.last_turn_id,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> EmotionState:
        vec_data = data.get("vector", {})
        ts = data.get("updated_at")
        return cls(
            vector=EmotionVector.from_dict(vec_data),
            version=int(data.get("version", 1)),
            last_turn_id=data.get("last_turn_id"),
            updated_at=datetime.fromisoformat(ts) if isinstance(ts, str) else None,
        )
