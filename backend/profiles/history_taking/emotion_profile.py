"""Personality-to-emotion mapping — drives baseline, reactivity, and decay."""

from __future__ import annotations

from dataclasses import dataclass

PERSONALITY_MODIFIERS: dict[str, dict[str, dict[str, float | int]]] = {
    "anxiety_trait": {
        "anxious": {"trust_base": -8, "comfort_base": -12, "neg_amplify": 1.4, "pos_amplify": 0.7, "decay": 0.08},
        "normal": {"trust_base": 0, "comfort_base": 0, "neg_amplify": 1.0, "pos_amplify": 1.0, "decay": 0.05},
        "calm": {"trust_base": 5, "comfort_base": 8, "neg_amplify": 0.7, "pos_amplify": 1.2, "decay": 0.03},
    },
    "patience": {
        "low": {"comfort_base": -3, "decay": 0.08},
        "normal": {"comfort_base": 0, "decay": 0.05},
        "high": {"comfort_base": 3, "decay": 0.02},
    },
    "health_literacy": {
        "low": {"trust_base": -2},
        "normal": {},
        "high": {"trust_base": 2},
    },
    "mood": {
        "neutral": {},
        "low": {"comfort_base": -10, "pos_amplify": 0.6, "decay": 0.07},
        "irritable": {"comfort_base": -8, "neg_amplify": 1.5, "pos_amplify": 0.5},
        "fearful": {"comfort_base": -5, "neg_amplify": 1.3, "pos_amplify": 1.3, "decay": 0.09},
    },
    "compliance": {
        "resistant": {"trust_base": -10, "comfort_base": -5, "pos_amplify": 0.5, "decay": 0.02},
        "normal": {},
        "dependent": {"trust_base": 8, "pos_amplify": 1.5, "neg_amplify": 1.2},
    },
}


@dataclass(frozen=True)
class PersonalityProfile:
    """Personality-driven emotion parameters derived from case_data.personality.

    Fields:
      trust_base:    baseline trust (clamped 25-75)
      comfort_base:  baseline comfort (clamped 25-75)
      neg_amplify:   multiplier for negative deltas
      pos_amplify:   multiplier for positive deltas
      decay:         per-minute regression rate toward baseline (0.01-0.15)
    """

    trust_base: int = 50
    comfort_base: int = 50
    neg_amplify: float = 1.0
    pos_amplify: float = 1.0
    decay: float = 0.05

    @classmethod
    def from_personality(cls, personality: dict) -> PersonalityProfile:
        """Build profile from case_data.personality dict. Unknown keys/values use defaults."""
        t = 50
        c = 50
        na = 1.0
        pa = 1.0
        d = 0.05

        for trait, choices in PERSONALITY_MODIFIERS.items():
            value = personality.get(trait, "normal")
            mods = choices.get(value, {})
            t += int(mods.get("trust_base", 0))
            c += int(mods.get("comfort_base", 0))
            if "neg_amplify" in mods:
                na = float(mods["neg_amplify"])
            if "pos_amplify" in mods:
                pa = float(mods["pos_amplify"])
            if "decay" in mods:
                d = float(mods["decay"])

        t = max(25, min(75, t))
        c = max(25, min(75, c))
        d = max(0.01, min(0.15, d))

        return cls(trust_base=t, comfort_base=c, neg_amplify=na, pos_amplify=pa, decay=d)

    def amplify(self, dt: int, dc: int) -> tuple[int, int]:
        """Apply personality modulation to raw (trust_delta, comfort_delta).

        Uses neg_amplify when either delta is negative, pos_amplify otherwise.
        Uses round() instead of int() to prevent systematic rounding-toward-zero
        that makes small positive deltas vanish (e.g. int(1 * 0.7) = 0).
        """
        if dt < 0 or dc < 0:
            return (round(dt * self.neg_amplify), round(dc * self.neg_amplify))
        return (round(dt * self.pos_amplify), round(dc * self.pos_amplify))
