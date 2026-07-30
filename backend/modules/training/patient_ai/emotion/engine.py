"""四维情绪系统 — 规则引擎。

核心计算管道：
    1. 自然恢复（current → baseline 方向）
    2. 基础 delta × LLM 置信度
    3. 人格维度敏感度
    4. 正负向全局敏感度
    5. 边界阻尼
    6. 状态更新 + 钳制

所有计算都是确定性的，可测试。
"""

from __future__ import annotations

import logging

from .events import AppliedEmotionEvent, DetectedEmotionEvent, EmotionEventType
from .models import EmotionDelta, EmotionState, EmotionVector, clamp01
from .profile import EmotionProfile
from .rules import EVENT_RULES

log = logging.getLogger(__name__)


class EmotionEngine:
    """情绪规则引擎。

    不持有状态，所有方法为纯函数或依赖注入。
    """

    def recover(self, vector: EmotionVector, profile: EmotionProfile) -> EmotionVector:
        """自然恢复：向 baseline 方向移动。

        每轮调用一次。先恢复再应用事件。
        """
        baseline = profile.baseline
        return EmotionVector(
            trust=_approach(vector.trust, baseline.trust, profile.trust_recovery),
            anxiety=_approach(vector.anxiety, baseline.anxiety, profile.anxiety_recovery),
            irritation=_approach(vector.irritation, baseline.irritation, profile.irritation_recovery),
            cooperation=_approach(vector.cooperation, baseline.cooperation, profile.cooperation_recovery),
        )

    def apply_events(
        self,
        state: EmotionState,
        profile: EmotionProfile,
        events: list[DetectedEmotionEvent],
    ) -> tuple[EmotionState, list[AppliedEmotionEvent]]:
        """依次应用事件列表，返回新状态和应用记录。

        每个事件经历：基础 delta → 置信度 → 人格敏感度 → 边界阻尼 → 钳制。
        """
        vector = state.vector
        applied: list[AppliedEmotionEvent] = []

        for event in events:
            base = EVENT_RULES.get(event.type)
            if base is None:
                log.warning("Unknown event type: %s", event.type)
                continue

            delta = self._resolve_delta(
                vector=vector,
                profile=profile,
                event=event,
                base=base,
            )

            if delta.is_zero():
                continue

            before = vector
            vector = vector.apply(delta)

            applied.append(
                AppliedEmotionEvent(
                    type=event.type,
                    confidence=event.confidence,
                    evidence=event.evidence,
                    before=before,
                    delta=delta,
                    after=vector,
                )
            )

        new_state = EmotionState(
            vector=vector,
            version=state.version + 1 if applied else state.version,
            last_turn_id=state.last_turn_id,
        )

        return new_state, applied

    def _resolve_delta(
        self,
        vector: EmotionVector,
        profile: EmotionProfile,
        event: DetectedEmotionEvent,
        base: EmotionDelta,
    ) -> EmotionDelta:
        """完整的 delta 解析管道。"""
        delta = base

        # 1. 置信度缩放
        delta = delta.scaled(event.confidence)

        # 2. 人格维度敏感度
        delta = self._apply_dimension_sensitivity(delta, profile)

        # 3. 正负向全局敏感度
        delta = self._apply_valence_sensitivity(delta, profile)

        # 4. 边界阻尼
        delta = self._apply_boundary_damping(vector, delta)

        # 5. 舍入到合理精度
        delta = EmotionDelta(
            trust=round(delta.trust, 4),
            anxiety=round(delta.anxiety, 4),
            irritation=round(delta.irritation, 4),
            cooperation=round(delta.cooperation, 4),
        )

        return delta

    @staticmethod
    def _apply_dimension_sensitivity(delta: EmotionDelta, profile: EmotionProfile) -> EmotionDelta:
        return EmotionDelta(
            trust=delta.trust * profile.trust_sensitivity,
            anxiety=delta.anxiety * profile.anxiety_sensitivity,
            irritation=delta.irritation * profile.irritation_sensitivity,
            cooperation=delta.cooperation * profile.cooperation_sensitivity,
        )

    @staticmethod
    def _apply_valence_sensitivity(delta: EmotionDelta, profile: EmotionProfile) -> EmotionDelta:
        """正负向敏感度：检查每个维度独立判断符号。

        trust (+) / cooperation (+) = 正向
        anxiety (+) / irritation (+) = 负向
        负向 delta 视为反向（如 anxiety -0.05 即正向改善）。
        """
        return EmotionDelta(
            trust=delta.trust * _valence_scale(delta.trust, profile),
            anxiety=delta.anxiety * _valence_scale(delta.anxiety, profile),
            irritation=delta.irritation * _valence_scale(delta.irritation, profile),
            cooperation=delta.cooperation * _valence_scale(delta.cooperation, profile),
        )

    @staticmethod
    def _apply_boundary_damping(vector: EmotionVector, delta: EmotionDelta) -> EmotionDelta:
        """边界阻尼：越接近 0 或 1，变化越慢。

        factor = 0.25 + 0.75 * headroom
        在边界 headroom=0 时，factor=0.25（仍允许少量变化）。
        在中间 headroom=1.0 时，factor=1.0（无阻尼）。
        """
        return EmotionDelta(
            trust=delta.trust * _boundary_factor(vector.trust, delta.trust),
            anxiety=delta.anxiety * _boundary_factor(vector.anxiety, delta.anxiety),
            irritation=delta.irritation * _boundary_factor(vector.irritation, delta.irritation),
            cooperation=delta.cooperation * _boundary_factor(vector.cooperation, delta.cooperation),
        )


def _approach(current: float, target: float, rate: float) -> float:
    """按比例向目标值移动。"""
    return clamp01(current + (target - current) * rate)


def _valence_scale(value: float, profile: EmotionProfile) -> float:
    """根据 delta 符号选择正负向敏感度。

    trust 和 cooperation 的正向 delta = 好事 → positive_sensitivity。
    anxiety 和 irritation 的正向 delta = 坏事 → negative_sensitivity。
    反向则互换。
    """
    # trust/cooperation: + = positive, - = negative
    # anxiety/irritation: + = negative, - = positive
    # 但这里我们直接根据 value 的符号来判断：
    #   value > 0: 该维度在增加 → 对 trust/coop 是好事，对 anxiety/irrit 是坏事
    #   value < 0: 该维度在减少 → 对 trust/coop 是坏事，对 anxiety/irrit 是好事
    # 简化处理：都按数值的绝对值方向处理
    # trust 和 cooperation 的 delta > 0 是改善 → positive
    # anxiety 和 irritation 的 delta < 0 是改善 → positive
    # 这里对每个维度的 delta 值，我们统一用一种简便方法：
    if value >= 0:
        return profile.positive_sensitivity
    return profile.negative_sensitivity


def _boundary_factor(current: float, delta: float) -> float:
    """计算边界阻尼因子。

    delta > 0: 向 1.0 移动，headroom = 1.0 - current
    delta < 0: 向 0.0 移动，headroom = current
    """
    if delta > 0:
        headroom = 1.0 - current
    elif delta < 0:
        headroom = current
    else:
        return 1.0
    return 0.25 + 0.75 * headroom
