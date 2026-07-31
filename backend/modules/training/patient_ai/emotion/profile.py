"""四维情绪系统 — 人格配置映射。

将病例人格 (personality dict) 映射为 EmotionProfile。
EmotionProfile 只负责：
    初始状态 (baseline)
    事件敏感度 (各维度、正负向)
    自然恢复速度
    行为倾向
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import EmotionVector, clamp01

# ── 旧五维人格 → 新四维的映射表 ──
# 每个 trait 的每个 level 提供偏移值，最终汇总。
_PERSONALITY_MAP: dict[str, dict[str, dict[str, float]]] = {
    "anxiety_trait": {
        "anxious": {
            "trust": -0.12,
            "anxiety": 0.25,
            "irritation": 0.05,
            "cooperation": 0.0,
            "anxiety_sensitivity": 0.8,
            "anxiety_recovery": 0.02,
        },
        "normal": {
            "trust": 0.0,
            "anxiety": 0.0,
            "irritation": 0.0,
            "cooperation": 0.0,
            "anxiety_sensitivity": 0.5,
            "anxiety_recovery": 0.04,
        },
        "calm": {
            "trust": 0.05,
            "anxiety": -0.15,
            "irritation": -0.05,
            "cooperation": 0.05,
            "anxiety_sensitivity": 0.3,
            "anxiety_recovery": 0.06,
        },
    },
    "patience": {
        "low": {
            "irritation": 0.10,
            "irritation_sensitivity": 0.8,
            "irritation_recovery": 0.03,
        },
        "normal": {
            "irritation": 0.0,
            "irritation_sensitivity": 0.5,
            "irritation_recovery": 0.06,
        },
        "high": {
            "irritation": -0.08,
            "irritation_sensitivity": 0.3,
            "irritation_recovery": 0.09,
        },
    },
    "health_literacy": {
        "low": {"trust": -0.03},
        "normal": {},
        "high": {"trust": 0.03},
    },
    "mood": {
        "neutral": {},
        "low": {
            "anxiety": 0.05,
            "irritation": 0.03,
            "cooperation": -0.05,
            "negative_sensitivity": 0.2,
        },
        "irritable": {
            "irritation": 0.15,
            "cooperation": -0.08,
            "irritation_sensitivity": 0.6,
            "negative_sensitivity": 0.3,
        },
        "fearful": {
            "anxiety": 0.12,
            "trust": -0.03,
            "anxiety_sensitivity": 0.5,
            "positive_sensitivity": 0.2,
        },
    },
    "compliance": {
        "resistant": {
            "trust": -0.10,
            "cooperation": -0.12,
            "cooperation_sensitivity": 0.6,
            "positive_sensitivity": -0.2,
        },
        "normal": {},
        "dependent": {
            "trust": 0.08,
            "cooperation": 0.10,
            "cooperation_sensitivity": 0.5,
            "positive_sensitivity": 0.2,
            "negative_sensitivity": 0.2,
        },
    },
}


@dataclass(frozen=True, slots=True)
class EmotionProfile:
    """人格驱动的情绪参数。

    所有数值范围 [0.0, 1.0]（baseline）、或非负倍数（sensitivity、recovery）。
    """

    # ── 初始状态 ──
    baseline: EmotionVector

    # ── 维度敏感度（>1 = 对该维度更敏感） ──
    trust_sensitivity: float = 1.0
    anxiety_sensitivity: float = 1.0
    irritation_sensitivity: float = 1.0
    cooperation_sensitivity: float = 1.0

    # ── 正负向全局敏感度（>1 = 对正向/负向事件更敏感） ──
    positive_sensitivity: float = 1.0
    negative_sensitivity: float = 1.0

    # ── 自然恢复速率（每轮恢复比例，0=不恢复，1=瞬间回基线） ──
    trust_recovery: float = 0.01
    anxiety_recovery: float = 0.04
    irritation_recovery: float = 0.06
    cooperation_recovery: float = 0.03

    @classmethod
    def from_personality(cls, personality: dict) -> EmotionProfile:
        """从病例 personality dict 构建 EmotionProfile。

        兼容旧五维格式：anxiety_trait, patience, health_literacy, mood, compliance。
        未知 trait/level 使用中性默认值。
        """
        # 从人格基线开始计算
        baseline = EmotionVector(
            trust=clamp01(0.45),
            anxiety=clamp01(0.25),
            irritation=clamp01(0.35),
            cooperation=clamp01(0.35),
        )

        sensitivities = {
            "trust_sensitivity": 0.0,
            "anxiety_sensitivity": 0.0,
            "irritation_sensitivity": 0.0,
            "cooperation_sensitivity": 0.0,
            "positive_sensitivity": 0.0,
            "negative_sensitivity": 0.0,
        }

        recoveries = {
            "trust_recovery": 0.01,
            "anxiety_recovery": 0.04,
            "irritation_recovery": 0.06,
            "cooperation_recovery": 0.03,
        }

        # 累计人格偏移
        baseline_add = {"trust": 0.0, "anxiety": 0.0, "irritation": 0.0, "cooperation": 0.0}

        for trait, levels in _PERSONALITY_MAP.items():
            level = personality.get(trait, "normal")
            mods = levels.get(level, {})
            for dim in ("trust", "anxiety", "irritation", "cooperation"):
                if dim in mods:
                    baseline_add[dim] += mods[dim]
            for key in sensitivities:
                if key in mods:
                    sensitivities[key] += mods[key]
            for key in recoveries:
                if key in mods:
                    recoveries[key] = mods[key]

        baseline = EmotionVector(
            trust=clamp01(0.45 + baseline_add["trust"]),
            anxiety=clamp01(0.25 + baseline_add["anxiety"]),
            irritation=clamp01(0.35 + baseline_add["irritation"]),
            cooperation=clamp01(0.35 + baseline_add["cooperation"]),
        )

        return cls(
            baseline=baseline,
            trust_sensitivity=max(0.2, 1.0 + sensitivities["trust_sensitivity"]),
            anxiety_sensitivity=max(0.2, 1.0 + sensitivities["anxiety_sensitivity"]),
            irritation_sensitivity=max(0.2, 1.0 + sensitivities["irritation_sensitivity"]),
            cooperation_sensitivity=max(0.2, 1.0 + sensitivities["cooperation_sensitivity"]),
            positive_sensitivity=max(0.2, 1.0 + sensitivities["positive_sensitivity"]),
            negative_sensitivity=max(0.2, 1.0 + sensitivities["negative_sensitivity"]),
            trust_recovery=clamp01(recoveries["trust_recovery"]),
            anxiety_recovery=clamp01(recoveries["anxiety_recovery"]),
            irritation_recovery=clamp01(recoveries["irritation_recovery"]),
            cooperation_recovery=clamp01(recoveries["cooperation_recovery"]),
        )

    @classmethod
    def neutral(cls) -> EmotionProfile:
        """中性人格配置。"""
        return cls(baseline=EmotionVector.neutral())
