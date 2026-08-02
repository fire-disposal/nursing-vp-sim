"""Unit tests for initiative engine — pure, no database.

覆盖重设计核心：四维情绪 → 策略推导（will_speak/threshold/tone）+
端点权威守卫（max_reached/patient_silent/cooldown/not_ready）。
"""

from datetime import UTC, datetime

from models import TrainingSessionState
from modules.training.patient_ai.emotion import EmotionVector
from modules.training.patient_ai.initiative import (
    MAX_INITIATIVE_PER_SESSION,
    build_patient_context,
    can_initiate,
    derive_initiative_policy,
)
from modules.training.session.cache import InitiativeCache
from tests._fakes import FakeSession

PERSONALITY = {
    "health_literacy": "normal",
    "verbosity": "normal",
    "anxiety_trait": "normal",
    "patience": "normal",
}


def _vector(**kw) -> EmotionVector:
    base = dict(trust=0.5, anxiety=0.3, irritation=0.2, cooperation=0.6)
    base.update(kw)
    return EmotionVector(**base)


class TestDerivePolicy:
    def test_withdrawn_patient_stays_silent(self):
        policy = derive_initiative_policy(_vector(trust=0.2, anxiety=0.6, cooperation=0.2), PERSONALITY)
        assert policy.will_speak is False
        assert policy.refusal == "withdrawn"

    def test_defensive_patient_rarely_initiates(self):
        policy = derive_initiative_policy(_vector(trust=0.2, irritation=0.5, cooperation=0.4), PERSONALITY)
        assert policy.will_speak is False
        assert policy.refusal == "defensive"

    def test_anxious_patient_initiates_earlier(self):
        anxious = derive_initiative_policy(_vector(anxiety=0.8, irritation=0.1), PERSONALITY)
        calm = derive_initiative_policy(_vector(anxiety=0.1, irritation=0.1), PERSONALITY)
        assert anxious.threshold < calm.threshold

    def test_open_patient_initiates_casually(self):
        policy = derive_initiative_policy(_vector(trust=0.8, anxiety=0.1, irritation=0.1, cooperation=0.8), PERSONALITY)
        assert policy.will_speak is True
        assert policy.threshold >= 30

    def test_threshold_clamped_upper(self):
        policy = derive_initiative_policy(
            _vector(trust=0.9, anxiety=0.0, irritation=0.0, cooperation=0.9),
            dict(PERSONALITY, patience="high", anxiety_trait="calm"),
        )
        assert policy.threshold <= 90

    def test_threshold_clamped_lower(self):
        policy = derive_initiative_policy(
            _vector(trust=0.5, anxiety=0.9, irritation=0.9, cooperation=0.5),
            dict(PERSONALITY, patience="low", anxiety_trait="anxious"),
        )
        assert policy.threshold >= 15


class TestPatientContext:
    def test_includes_patient_known_fields_only(self):
        case = {
            "patient_info": {"name": "王建国", "age": 68, "gender": "男"},
            "chief_complaint": "喘不上气",
            "present_illness": "两天了",
            "personality": {"patience": "low"},
            "allergy_history": "青霉素过敏",
            "deep_background": {"职业": "退休工人"},
        }
        text = build_patient_context(case)
        assert "王建国" in text
        assert "喘不上气" in text
        assert "青霉素过敏" in text
        assert "缺乏耐心" in text
        # 医生视角信息绝不注入主动追问
        assert "退休工人" not in text

    def test_defaults_for_empty_case(self):
        text = build_patient_context({})
        assert "患者" in text
        assert "主诉：无" in text


class TestCanInitiate:
    def _seed(self, count=0, timer_age=120, last_trigger_age=None):
        db = FakeSession()
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        db.rows[1] = TrainingSessionState(
            record_id=1,
            initiative_count=count,
            initiative_timer=now - timer_age,
            initiative_last_trigger=now - last_trigger_age if last_trigger_age else None,
        )
        return cache, db

    def test_allows_when_ready(self):
        cache, db = self._seed(count=0, timer_age=120, last_trigger_age=600)
        ok, reason = can_initiate(1, cache, db, derive_initiative_policy(_vector(), PERSONALITY))
        assert ok is True
        assert reason is None

    def test_rejects_when_session_max_reached(self):
        cache, db = self._seed(count=MAX_INITIATIVE_PER_SESSION, timer_age=120, last_trigger_age=600)
        ok, reason = can_initiate(1, cache, db, derive_initiative_policy(_vector(), PERSONALITY))
        assert ok is False
        assert reason == "max_reached"

    def test_rejects_silent_patient(self):
        cache, db = self._seed(count=0, timer_age=120, last_trigger_age=600)
        ok, reason = can_initiate(1, cache, db, derive_initiative_policy(_vector(trust=0.2, cooperation=0.2), PERSONALITY))
        assert ok is False
        assert reason == "withdrawn"

    def test_rejects_within_cooldown(self):
        cache, db = self._seed(count=0, timer_age=120, last_trigger_age=10)
        ok, reason = can_initiate(1, cache, db, derive_initiative_policy(_vector(), PERSONALITY))
        assert ok is False
        assert reason == "cooldown"

    def test_rejects_before_threshold(self):
        cache, db = self._seed(count=0, timer_age=5, last_trigger_age=600)
        ok, reason = can_initiate(1, cache, db, derive_initiative_policy(_vector(), PERSONALITY))
        assert ok is False
        assert reason == "not_ready"
