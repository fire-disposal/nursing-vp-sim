# Emotion System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace keyword-based emotion analysis with LLM-driven personality-grounded dynamics (S-curve trust, decay, bounded history).

**Architecture:** New `PersonalityProfile` maps personality traits → baseline/reactive/decay parameters. `EmotionState` gains S-curve delta modulation and natural decay. LLM outputs structured `{"emotion":{...}}` JSON in the same response, replacing keyword matchers. All existing interfaces (EmotionCache, SSE events, TTS mapping) are preserved.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy, existing EmotionCache/TrainingSessionState

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/profiles/history_taking/emotion_profile.py` | **Create** | PersonalityProfile dataclass + modifier tables |
| `backend/infrastructure/llm/prompts/emotion.py` | **Create** | LLM prompt fragment for emotion JSON output |
| `backend/profiles/history_taking/emotion.py` | **Rewite** | EmotionState + S-curve + decay + bounded history |
| `backend/contexts/training/pipeline/middleware/side_effects.py` | **Modify** | Replace keywords → LLM JSON extraction + decay |
| `backend/profiles/history_taking/initiative.py` | **Modify** | Replace `_describe_mood()` with emotion.state |
| `backend/infrastructure/llm/capabilities.py` | **Modify** | Fix "5态" → "6态" in description |
| `backend/contexts/training/pipeline/middleware/prompt_builder.py` | **Modify** | Inject emotion output instruction into system prompt |
| `backend/tests/training/test_personality_profile.py` | **Create** | Unit tests for PersonalityProfile |
| `backend/tests/training/test_emotion.py` | **Modify** | Update for new EmotionState API |

---

### Task 1: PersonalityProfile

**Files:**
- Create: `backend/profiles/history_taking/emotion_profile.py`
- Create: `backend/tests/training/test_personality_profile.py`

- [ ] **Step 1: Write the test file**

```python
"""Tests for PersonalityProfile — personality-to-emotion parameter mapping."""

import pytest
from profiles.history_taking.emotion_profile import PersonalityProfile


class TestPersonalityProfileDefaults:
    def test_default_personality(self):
        profile = PersonalityProfile.from_personality({})
        assert profile.trust_base == 50
        assert profile.comfort_base == 50
        assert profile.neg_amplify == 1.0
        assert profile.pos_amplify == 1.0
        assert profile.decay == pytest.approx(0.05)

    def test_unknown_trait_defaults_to_normal(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "unknown_value"})
        assert profile.trust_base == 50
        assert profile.comfort_base == 50


class TestPersonalityProfileDeviations:
    def test_anxious(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        assert profile.trust_base == 42   # 50 - 8
        assert profile.comfort_base == 38 # 50 - 12
        assert profile.neg_amplify == 1.4
        assert profile.pos_amplify == 0.7

    def test_calm(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "calm"})
        assert profile.trust_base == 55
        assert profile.comfort_base == 58
        assert profile.neg_amplify == 0.7
        assert profile.pos_amplify == 1.2

    def test_low_patience(self):
        profile = PersonalityProfile.from_personality({"patience": "low"})
        assert profile.comfort_base == 47  # 50 - 3
        assert profile.decay == pytest.approx(0.08)

    def test_high_patience(self):
        profile = PersonalityProfile.from_personality({"patience": "high"})
        assert profile.comfort_base == 53  # 50 + 3
        assert profile.decay == pytest.approx(0.02)

    def test_low_literacy(self):
        profile = PersonalityProfile.from_personality({"health_literacy": "low"})
        assert profile.trust_base == 48  # 50 - 2

    def test_high_literacy(self):
        profile = PersonalityProfile.from_personality({"health_literacy": "high"})
        assert profile.trust_base == 52  # 50 + 2


class TestPersonalityProfileCombined:
    def test_anxious_low_patience_low_literacy(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "anxious",
            "patience": "low",
            "health_literacy": "low",
        })
        # trust: 50 - 8 - 0 - 2 = 40
        assert profile.trust_base == 40
        # comfort: 50 - 12 - 3 - 0 = 35
        assert profile.comfort_base == 35
        assert profile.neg_amplify == 1.4
        assert profile.pos_amplify == 0.7
        assert profile.decay == pytest.approx(0.08)

    def test_calm_high_patience_high_literacy(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "calm",
            "patience": "high",
            "health_literacy": "high",
        })
        assert profile.trust_base == 57  # 50 + 5 + 0 + 2
        assert profile.comfort_base == 61 # 50 + 8 + 3 + 0
        assert profile.neg_amplify == 0.7
        assert profile.pos_amplify == 1.2
        assert profile.decay == pytest.approx(0.02)


class TestPersonalityProfileClamping:
    def test_trust_clamped_low(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "anxious",
            "patience": "low",
            "health_literacy": "low",
        })
        assert profile.trust_base >= 25

    def test_trust_clamped_high(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "calm",
            "health_literacy": "high",
        })
        assert profile.trust_base <= 75


class TestPersonalityProfileAmplify:
    def test_amplify_negative_with_anxious(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        dt, dc = profile.amplify(-2, -3)
        assert dt == -2  # -2 * 1.4 = -2.8 → int(-2)
        assert dc == -4  # -3 * 1.4 = -4.2 → int(-4)

    def test_amplify_positive_with_anxious(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        dt, dc = profile.amplify(2, 3)
        assert dt == 1   # 2 * 0.7 = 1.4 → int(1)
        assert dc == 2   # 3 * 0.7 = 2.1 → int(2)

    def test_amplify_mixed_sign_defaults_to_negative(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        dt, dc = profile.amplify(-1, 2)
        assert dt == -1  # negative dt triggers neg_amplify
        assert dc == 2   # negative dt triggers neg_amplify → 2 * 1.4 = 2.8 → int(2)

    def test_amplify_default_neutral(self):
        profile = PersonalityProfile.from_personality({})
        assert profile.amplify(3, 2) == (3, 2)
        assert profile.amplify(-3, -2) == (-3, -2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/training/test_personality_profile.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'profiles.history_taking.emotion_profile'`

- [ ] **Step 3: Write the implementation**

```python
"""Personality-to-emotion mapping — drives baseline, reactivity, and decay."""

from __future__ import annotations

from dataclasses import dataclass

PERSONALITY_MODIFIERS: dict[str, dict[str, dict[str, float | int]]] = {
    "anxiety_trait": {
        "anxious": {"trust_base": -8, "comfort_base": -12, "neg_amplify": 1.4, "pos_amplify": 0.7, "decay": 0.08},
        "normal":  {"trust_base":  0, "comfort_base":   0, "neg_amplify": 1.0, "pos_amplify": 1.0, "decay": 0.05},
        "calm":    {"trust_base":  5, "comfort_base":   8, "neg_amplify": 0.7, "pos_amplify": 1.2, "decay": 0.03},
    },
    "patience": {
        "low":    {"comfort_base": -3, "decay": 0.08},
        "normal": {"comfort_base":  0, "decay": 0.05},
        "high":   {"comfort_base":  3, "decay": 0.02},
    },
    "health_literacy": {
        "low":    {"trust_base": -2},
        "normal": {},
        "high":   {"trust_base":  2},
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
        """
        if dt < 0 or dc < 0:
            return (int(dt * self.neg_amplify), int(dc * self.neg_amplify))
        return (int(dt * self.pos_amplify), int(dc * self.pos_amplify))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/training/test_personality_profile.py -v`
Expected: 15 passed

- [ ] **Step 5: Commit**

```bash
git add backend/profiles/history_taking/emotion_profile.py backend/tests/training/test_personality_profile.py
git commit -m "✨ feat: PersonalityProfile — personality-driven emotion baseline/reactive/decay"
```

---

### Task 2: LLM Prompt Fragment for Emotion Output

**Files:**
- Create: `backend/infrastructure/llm/prompts/emotion.py`

- [ ] **Step 1: Write the prompt module**

```python
"""LLM prompt fragment instructing emotion-structured output."""

EMOTION_OUTPUT_INSTRUCTION = """
【情感输出规则】
在回复末尾，你必须附加一个单独的 JSON 块（不要包含在患者话语中）：
{"emotion":{"trust_delta":-3到3的整数,"comfort_delta":-3到3的整数,"trigger":"破冰/共鸣/刺伤/无"}}

- trust_delta: 你对护士专业能力的信任变化。-3=严重削弱信任，+3=显著增强信任，0=无变化。
- comfort_delta: 你的舒适/放松程度变化。-3=很不舒服，+3=明显放松，0=无变化。
- trigger: 特殊事件标记。
  * "破冰"=护士首次表达真诚共情或使用你喜欢的称呼
  * "共鸣"=你主动透露了护士未直接问及的私密信息
  * "刺伤"=护士使用恐惧性语言或明显忽视你的主诉
  * "无"=本轮无特殊事件

格式要求：JSON 块独立一行，不要嵌套在引号或 Markdown 中。
示例回复末尾：
我觉得最近好多了。
{"emotion":{"trust_delta":2,"comfort_delta":1,"trigger":"无"}}

当前患者状态：信任{trust}/100 舒适{comfort}/100 状态{emotion_label}
患者性格：{personality_description}
"""
```

- [ ] **Step 2: Commit**

```bash
git add backend/infrastructure/llm/prompts/emotion.py
git commit -m "✨ feat: emotion output instruction prompt fragment for LLM"
```

---

### Task 3: Rewrite EmotionState with S-Curve + Decay + Bounded History

**Files:**
- Modify: `backend/profiles/history_taking/emotion.py` (full rewrite)

- [ ] **Step 1: Read current file to confirm understanding**

Already read — confirmed 162 lines with STATE_LABELS, EmotionState dataclass, _build_author_note, get_emotion/cleanup_emotion.

- [ ] **Step 2: Rewrite emotion.py**

Key changes:
- Remove `STATE_LABELS` first-match table; replace with a simple threshold lookup.
- `EmotionState` gains `profile` (PersonalityProfile), `last_updated` timestamp.
- `update()` applies S-curve modulation and bounded history (collections.deque, maxlen=10).
- `apply_decay()` computes regression toward baseline based on elapsed time.
- Keep `get_emotion()`, `cleanup_emotion()`, `_build_author_note()` — same public API.

```python
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

from infrastructure.cache import EmotionCache
from profiles.history_taking.emotion_profile import PersonalityProfile

log = logging.getLogger(__name__)

# ── 状态标签：首次匹配，优先级从高到低 ──
# (trust_min, comfort_min) → (label, description)
_STATE_TABLE: list[tuple[int, int, str, str]] = [
    (70, 70, "open",      "开放信任，愿意详述"),
    (30, 60, "relaxed",   "放松配合，语气友好"),
    (30, 35, "neutral",   "正常配合"),
    (30,  0, "anxious",   "焦虑不安"),
    ( 0, 30, "defensive", "防御抵触"),
    ( 0,  0, "withdrawn", "沉默回避"),
]

MAX_HISTORY = 10


def _lookup_state(trust: int, comfort: int) -> tuple[str, str]:
    for t_min, c_min, label, desc in _STATE_TABLE:
        if trust >= t_min and comfort >= c_min:
            return label, desc
    return ("neutral", "正常配合")


def _s_curve(trust: int, delta: int) -> int:
    """Apply S-curve modulation: delta effectiveness peaks at trust=50, tapers at extremes."""
    factor = 1.0 - abs(trust - 50) / 50.0
    return int(delta * factor)


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

    @property
    def note(self) -> str:
        return _build_author_note(self.trust, self.comfort)

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
            self.history.append({
                "trust": self.trust,
                "comfort": self.comfort,
                "state": new_state,
                "intent": intent_label,
                "timestamp": now.isoformat(),
            })
            log.debug("情绪变化: %s(t=%d,c=%d) → %s(t=%d,c=%d) [%s]",
                old_state, old_trust, old_comfort, new_state, self.trust, self.comfort, intent_label)

    def to_dict(self) -> dict:
        return {
            "trust": self.trust,
            "comfort": self.comfort,
            "history": list(self.history),
        }

    @classmethod
    def from_dict(cls, data: dict, profile: PersonalityProfile | None = None) -> EmotionState:
        hist = data.get("history", [])
        if isinstance(hist, list):
            hist = deque(hist[-MAX_HISTORY:], maxlen=MAX_HISTORY)
        else:
            hist = deque(maxlen=MAX_HISTORY)
        ts_str = hist[-1]["timestamp"] if hist else None
        last_updated = datetime.fromisoformat(ts_str) if ts_str else None
        return cls(
            trust=data.get("trust", 50),
            comfort=data.get("comfort", 50),
            history=hist,
            profile=profile or PersonalityProfile(),
            last_updated=last_updated,
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


# ── 缓存 API ──

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
            state = EmotionState(
                trust=p.trust_base,
                comfort=p.comfort_base,
                profile=p,
            )
            cache.set(record_id, state, db)
            db.flush()
        else:
            if profile and state.profile.trust_base == 50 and profile.trust_base != 50:
                state.profile = profile
        return state


def cleanup_emotion(record_id: int, cache: EmotionCache, db: Session) -> None:
    cache.cleanup(record_id, db)
    with _emotion_locks_guard:
        _emotion_locks.pop(record_id, None)
```

- [ ] **Step 3: Run existing emotion tests to verify no regression**

Run: `uv run python -m pytest tests/training/test_emotion.py -x -q`
Expected: All pass (existing tests may need minor updates — see Task 8)

- [ ] **Step 4: Commit**

```bash
git add backend/profiles/history_taking/emotion.py
git commit -m "♻️ refactor: emotion state machine v2 — S-curve, decay, bounded history, personality profile"
```

---

### Task 4: Replace Keyword Matchers with LLM JSON Extraction in side_effects.py

**Files:**
- Modify: `backend/contexts/training/pipeline/middleware/side_effects.py`

- [ ] **Step 1: Remove keyword matchers and action analyzer**

Delete lines 16-163 (the entire `ACTION_EMOTION_DELTAS`, `_analyze_response_emotion()`, `_apply_action_emotion()` blocks). Keep only the `import re` line (still needed for JSON regex).

- [ ] **Step 2: Add LLM emotion JSON extraction and replace side_effects logic**

After the `import re` line (line 16), add:

```python
import json

_EMOTION_JSON_RE = re.compile(r'\{[^{}]*"emotion"[^{}]*\{[^{}]*\}[^{}]*\}')
_EMOTION_DELTA_RE = re.compile(r'"emotion"\s*:\s*\{[^}]*\}')

MAX_DELTA = 3


def _extract_emotion_delta(llm_reply: str) -> tuple[int, int, str]:
    """Extract structured emotion delta from LLM reply. Returns (trust_delta, comfort_delta, trigger).

    Searches the reply for a JSON block containing an "emotion" key.
    Falls back to (0, 0, "") on parse failure.
    """
    matches = _EMOTION_DELTA_RE.findall(llm_reply)
    for match in matches:
        try:
            parsed = json.loads("{" + match + "}")
            emotion = parsed.get("emotion", {})
            dt = max(-MAX_DELTA, min(MAX_DELTA, int(emotion.get("trust_delta", 0))))
            dc = max(-MAX_DELTA, min(MAX_DELTA, int(emotion.get("comfort_delta", 0))))
            trigger = str(emotion.get("trigger", ""))
            return dt, dc, trigger
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
    return 0, 0, ""
```

Then replace the emotion block in `side_effects()` (current lines 178-207) with:

```python
    if has_emotion and ctx.llm_reply:
        emotion_cache = getattr(app, "emotion_cache", None)
        if emotion_cache is None:
            return
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or {}
        profile = PersonalityProfile.from_personality(personality)
        emotion = get_emotion(ctx.record.id, emotion_cache, ctx.db, profile=profile)
        emotion.apply_decay()

        dt, dc, trigger = _extract_emotion_delta(ctx.llm_reply)

        if dt != 0 or dc != 0:
            emotion.update(dt, dc, trigger)
            emotion_cache.set(ctx.record.id, emotion, ctx.db)
            ctx.system_events.append(
                {
                    "emotion_change": {
                        "state": emotion.state,
                        "trust": emotion.trust,
                        "comfort": emotion.comfort,
                    }
                }
            )
```

Add the import for PersonalityProfile at the top of `side_effects()`:

```python
from profiles.history_taking.emotion_profile import PersonalityProfile
```

Actually, put the import at module level (top of file). Add after the existing imports:

```python
from profiles.history_taking.emotion_profile import PersonalityProfile
```

- [ ] **Step 3: Verify imports are correct**

Run: `uv run python -c "from contexts.training.pipeline.middleware.side_effects import side_effects; print('import ok')"`
Expected: `import ok`

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/pipeline/middleware/side_effects.py
git commit -m "♻️ refactor: replace keyword emotion matchers with LLM JSON extraction + decay"
```

---

### Task 5: Fix Capability Description ("5态" → "6态")

**Files:**
- Modify: `backend/infrastructure/llm/capabilities.py` (line 31)

- [ ] **Step 1: Fix the description**

Change line 31:
```python
description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化。虚拟病人的内置第一性质，全类型恒开。",
```
to:
```python
description="6态情绪模型（withdrawn/defensive/anxious/neutral/relaxed/open），根据学生用语动态变化。虚拟病人的内置第一性质，全类型恒开。",
```

- [ ] **Step 2: Regenerate capabilities for frontend consistency**

Run: `pnpm run cap:generate` (from monorepo root, if the script exists)

- [ ] **Step 3: Commit**

```bash
git add backend/infrastructure/llm/capabilities.py
git commit -m "📝 docs: fix emotion capability description — 5态 → 6态"
```

---

### Task 6: Align Initiative Mood Model with Emotion System

**Files:**
- Modify: `backend/profiles/history_taking/initiative.py`

- [ ] **Step 1: Replace `_describe_mood()` with emotion.state lookup**

Replace lines 93-100:
```python
def _describe_mood(trust: int, comfort: int) -> str:
    if comfort <= 30:
        return "焦虑不安"
    if trust <= 40:
        return "防御抵触"
    if comfort >= 60:
        return "放松配合"
    return "正常"
```
with:
```python
def _describe_mood(trust: int, comfort: int) -> str:
    from profiles.history_taking.emotion import _lookup_state

    label, _ = _lookup_state(trust, comfort)
    mood_map = {
        "withdrawn": "沉默回避",
        "defensive": "防御抵触",
        "anxious": "焦虑不安",
        "neutral": "正常",
        "relaxed": "放松配合",
        "open": "开放信任",
    }
    return mood_map.get(label, "正常")
```

Also update the fallback dict (lines 80-89):
```python
fallbacks = {
    "沉默回避": "（沉默地等着）",
    "防御抵触": "（沉默地等着）",
    "焦虑不安": "[不安地挪动身体]",
    "放松配合": "不急，你慢慢问。",
    "正常": "还有什么要问的吗？",
    "开放信任": "你还有什么想了解的？",
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/profiles/history_taking/initiative.py
git commit -m "♻️ refactor: unify initiative mood model with 6-state emotion system"
```

---

### Task 7: Inject Emotion Output Instruction into LLM System Prompt

**Files:**
- Modify: `backend/profiles/history_taking/builder.py`
- Modify: `backend/profiles/history_taking/profile.py`

**Context:** The system prompt is defined in `profile.py` using `{#variable#}` template syntax. Variables come from `builder.py::build_context_kwargs()` which returns a dict stored in `ctx.state[STATE_PATIENT_CONTEXT_KWARGS]` and registered as `"case"` in `PromptContext`. Adding a kwarg to `build_context_kwargs()` makes it available as `{#emotion_instruction#}` in the template. The author_note already provides current emotion state; this instruction tells the LLM HOW to output emotion JSON.

- [ ] **Step 1: Add emotion_instruction to builder.py**

In `backend/profiles/history_taking/builder.py`, after the `kwargs` dict is assigned (after line 79 `}`), add:

```python
    from infrastructure.llm.prompts.emotion import EMOTION_OUTPUT_INSTRUCTION

    kwargs["emotion_instruction"] = EMOTION_OUTPUT_INSTRUCTION
```

- [ ] **Step 2: Add {#emotion_instruction#} to system prompt template**

In `backend/profiles/history_taking/profile.py`, append `{#emotion_instruction#}` at the end of the system prompt string (after line 36 `""",`):

```python
    system="""你正在扮演一位真实患者。你不是AI，不是教学工具——你是一个活生生的人，正在医院里和一位护理学生对话。

## 身份

姓名：{#patient_info#}

## 场景

{#scenario#}

## 性格

{#personality#}

## 说话风格

{#communication_style#}

## 必须遵守

1. **按人设回应**
2. **像真人聊天** — 每次回答 1-3 句话
3. **只回答你知道的**
4. **不暴露身份**
5. **感知检查但不自知结果**

{#emotion_instruction#}
""",
```

- [ ] **Step 3: Verify template variable flows through**

Run: `uv run python -c "from profiles.history_taking.builder import build_context_kwargs; k = build_context_kwargs({'personality':{}}, 'test'); print('emotion_instruction' in k)"`
Expected: `True`

- [ ] **Step 4: Commit**

```bash
git add backend/profiles/history_taking/builder.py backend/profiles/history_taking/profile.py
git commit -m "✨ feat: inject emotion output instruction into LLM system prompt"
```

---

### Task 8: Update Existing Emotion Tests

**Files:**
- Modify: `backend/tests/training/test_emotion.py`

- [ ] **Step 1: Read current test file**

Run: check which tests exist and what they assert.

- [ ] **Step 2: Update tests for new EmotionState API**

The main changes:
1. `EmotionState` now requires or defaults to a `PersonalityProfile`
2. `history` is now a `deque(maxlen=10)` not a list
3. `update()` applies S-curve + personality amplification
4. New `apply_decay()` method
5. `from_dict()` accepts optional `profile` parameter

Update tests:

```python
"""Tests for EmotionState v2 — S-curve, decay, bounded history, personality profile."""

from collections import deque
from datetime import UTC, datetime, timedelta
from profiles.history_taking.emotion import (
    EmotionState,
    _lookup_state,
    _s_curve,
    MAX_HISTORY,
)
from profiles.history_taking.emotion_profile import PersonalityProfile


class TestStateLookup:
    def test_open(self):
        assert _lookup_state(80, 80) == ("open", "开放信任，愿意详述")

    def test_relaxed(self):
        assert _lookup_state(50, 70) == ("relaxed", "放松配合，语气友好")

    def test_neutral(self):
        assert _lookup_state(50, 50) == ("neutral", "正常配合")

    def test_anxious(self):
        assert _lookup_state(40, 20) == ("anxious", "焦虑不安")

    def test_defensive(self):
        assert _lookup_state(10, 40) == ("defensive", "防御抵触")

    def test_withdrawn(self):
        assert _lookup_state(10, 10) == ("withdrawn", "沉默回避")

    def test_fallback_neutral(self):
        # trust=20, comfort=20: doesn't match any above withdrawn (0,30) → anxious (30,0) → nope
        # Actually: checks (70,70) no, (30,60) no, (30,35) no, (30,0) no (trust=20<30), (0,30) no (comfort=20<30) → withdrawn (0,0)
        assert _lookup_state(20, 20) == ("withdrawn", "沉默回避")


class TestSCurve:
    def test_center_full_effect(self):
        assert _s_curve(50, 5) == 5   # 5 * 1.0
        assert _s_curve(50, -5) == -5

    def test_extreme_low_effect(self):
        assert _s_curve(0, 10) == 0    # 10 * 0.0
        assert _s_curve(0, -10) == 0

    def test_extreme_high_effect(self):
        assert _s_curve(100, 10) == 0  # 10 * 0.0

    def test_quarter_effect(self):
        assert _s_curve(25, 8) == 4    # 8 * 0.5
        assert _s_curve(75, 8) == 4    # 8 * 0.5


class TestEmotionStateDefault:
    def test_default_values(self):
        state = EmotionState()
        assert state.trust == 50
        assert state.comfort == 50
        assert state.state == "neutral"
        assert len(state.history) == 0

    def test_profile_default(self):
        state = EmotionState()
        assert state.profile.trust_base == 50
        assert state.profile.comfort_base == 50


class TestEmotionStateWithProfile:
    def test_profile_baseline(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        state = EmotionState(trust=42, comfort=38, profile=profile)
        assert state.trust == 42
        assert state.comfort == 38
        assert state.profile.trust_base == 42

    def test_amplified_update(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        state = EmotionState(trust=50, comfort=50, profile=profile)
        state.update(2, 2, "test")
        # pos_amplify=0.7: 2*0.7=1.4→1, S-curve at 50: 1*1.0=1
        assert state.trust == 51
        assert state.comfort == 51

    def test_negative_amplified(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        state = EmotionState(trust=50, comfort=50, profile=profile)
        state.update(-2, -2, "negative")
        # neg_amplify=1.4: -2*1.4=-2.8→-2, S-curve at 50: -2*1.0=-2
        assert state.trust == 48
        assert state.comfort == 48


class TestEmotionStateDecay:
    def test_decay_toward_baseline(self):
        profile = PersonalityProfile(trust_base=50, comfort_base=50, decay=0.6)
        state = EmotionState(trust=80, comfort=80, profile=profile,
                             last_updated=datetime.now(UTC) - timedelta(minutes=1))
        state.apply_decay()
        # decay = 0.6 * 1.0 = 0.6, trust = 80 + 0.6*(50-80) = 80 - 18 = 62
        # But trust is int: depends on rounding. Let's test loosely.
        assert 50 <= state.trust <= 70
        assert 50 <= state.comfort <= 70

    def test_decay_no_elapsed(self):
        profile = PersonalityProfile(trust_base=50, comfort_base=50, decay=1.0)
        state = EmotionState(trust=80, comfort=80, profile=profile,
                             last_updated=datetime.now(UTC))
        state.apply_decay()
        assert state.trust == 80
        assert state.comfort == 80


class TestEmotionStateHistoryBounds:
    def test_history_capped(self):
        state = EmotionState()
        for i in range(15):
            state.update(1, 0, f"turn_{i}")
        assert len(state.history) == MAX_HISTORY

    def test_history_order(self):
        state = EmotionState()
        state.update(1, 0, "first")
        state.update(0, 1, "second")
        assert state.history[0]["intent"] == "first"
        assert state.history[1]["intent"] == "second"


class TestEmotionStateSerialization:
    def test_to_dict_from_dict_roundtrip(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "calm"})
        state = EmotionState(trust=60, comfort=65, profile=profile)
        state.update(2, 1, "test")
        data = state.to_dict()
        restored = EmotionState.from_dict(data, profile=profile)
        assert restored.trust == state.trust
        assert restored.comfort == state.comfort
        assert restored.state == state.state
        assert restored.profile.trust_base == profile.trust_base

    def test_from_dict_with_legacy_data(self):
        data = {"trust": 60, "comfort": 40, "history": []}
        state = EmotionState.from_dict(data)
        assert state.trust == 60
        assert state.comfort == 40
        assert state.profile.trust_base == 50  # default profile
```

- [ ] **Step 3: Run tests**

Run: `uv run python -m pytest tests/training/test_emotion.py -x -q`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add backend/tests/training/test_emotion.py
git commit -m "✅ test: update emotion tests for v2 S-curve, decay, profile, bounded history"
```

---

### Task 9: Run Full Test Suite and Verification

**Files:** All changed files

- [ ] **Step 1: Run backend ruff check**

```bash
cd backend && uv run ruff check
```
Expected: All checks passed

- [ ] **Step 2: Run backend type check**

```bash
cd backend && uv run ty check
```
Expected: All checks passed

- [ ] **Step 3: Run full scoring + training + emotion tests**

```bash
cd backend && uv run python -m pytest tests/training/ tests/scoring/ -x -q
```
Expected: All pass

- [ ] **Step 4: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors (no frontend changes in this plan)

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "🔧 chore: final lint and type fixes for emotion v2"
```

---

### Task 10: Regenerate Frontend Capabilities

**Files:**
- Regenerate: `frontend/src/engine/capabilities.gen.ts`

- [ ] **Step 1: Regenerate from monorepo root**

```bash
pnpm run cap:generate
```
Or if that script doesn't exist standalone:
```bash
pnpm run api:update
```

Expected: `capabilities.gen.ts` updated with "6态" in the description.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/engine/capabilities.gen.ts
git commit -m "🔧 chore: regenerate capabilities.gen.ts — emotion 6-state description"
```
