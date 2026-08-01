"""Tests for exam → emotion bridge (feedback id=30: exam results never moved 4D emotion)."""

from modules.training.patient_ai.emotion.events import EmotionEventType
from modules.training.tools.exam_emotion import apply_exam_emotion, derive_exam_emotion_events


def _types(events):
    return [e.type for e in events]


class TestDeriveExamEmotionEvents:
    def test_pain_severe_triggers_painful_exam(self):
        events = derive_exam_emotion_events("pain", "8", 1)
        assert _types(events) == [EmotionEventType.PAINFUL_EXAM]
        assert events[0].confidence == 1.0

    def test_pain_moderate_triggers_painful_exam_lower_confidence(self):
        events = derive_exam_emotion_events("pain", "5", 1)
        assert _types(events) == [EmotionEventType.PAINFUL_EXAM]
        assert events[0].confidence == 0.7

    def test_pain_low_no_event(self):
        assert derive_exam_emotion_events("pain", "2", 1) == []

    def test_fever_temp_triggers_fever(self):
        events = derive_exam_emotion_events("temp", "38.5", 1)
        assert _types(events) == [EmotionEventType.FEVER]
        assert events[0].confidence == 1.0

    def test_normal_temp_no_event(self):
        assert derive_exam_emotion_events("temp", "36.8", 1) == []

    def test_normal_vital_no_event(self):
        assert derive_exam_emotion_events("hr", "72", 1) == []

    def test_repeated_measure_triggers_impatience(self):
        events = derive_exam_emotion_events("hr", "72", 3)
        assert _types(events) == [EmotionEventType.LONG_WAIT]

    def test_single_measure_no_impatience(self):
        assert derive_exam_emotion_events("hr", "72", 1) == []

    def test_pain_plus_repeat_combines(self):
        events = derive_exam_emotion_events("pain", "8", 3)
        assert _types(events) == [EmotionEventType.PAINFUL_EXAM, EmotionEventType.LONG_WAIT]

    def test_garbage_value_no_event(self):
        assert derive_exam_emotion_events("temp", "n/a", 1) == []


class TestApplyExamEmotion:
    def test_fever_persists_state_and_event(self, db_session, student, test_case):
        from models import TrainingRecord, TrainingSessionEmotionEvent, TrainingSessionEmotionState

        user, _token = student
        record = TrainingRecord(
            user_id=user.id,
            case_id=test_case.id,
            status="in_progress",
            training_type="history_taking",
            case_snapshot=test_case.case_data,
        )
        db_session.add(record)
        db_session.flush()

        result = apply_exam_emotion(
            record_id=record.id,
            case_data=test_case.case_data,
            op_type="temp",
            value="38.5",
            count=1,
            db=db_session,
        )
        assert result is not None
        assert result["anxiety"] > 0.5  # baseline 0.5 + FEVER anxiety delta
        assert result["dominant_state"]

        row = (
            db_session.query(TrainingSessionEmotionState)
            .filter(TrainingSessionEmotionState.record_id == record.id)
            .first()
        )
        assert row is not None
        assert row.anxiety > 0.5
        assert row.version == 2  # created at version 1, one applied update

        events = (
            db_session.query(TrainingSessionEmotionEvent)
            .filter(TrainingSessionEmotionEvent.record_id == record.id)
            .all()
        )
        assert len(events) == 1
        assert events[0].event_type == "fever"

    def test_no_signal_returns_none_and_writes_nothing(self, db_session, student, test_case):
        from models import TrainingRecord, TrainingSessionEmotionState

        user, _token = student
        record = TrainingRecord(
            user_id=user.id,
            case_id=test_case.id,
            status="in_progress",
            training_type="history_taking",
            case_snapshot=test_case.case_data,
        )
        db_session.add(record)
        db_session.flush()

        result = apply_exam_emotion(
            record_id=record.id,
            case_data=test_case.case_data,
            op_type="hr",
            value="72",
            count=1,
            db=db_session,
        )
        assert result is None
        row = (
            db_session.query(TrainingSessionEmotionState)
            .filter(TrainingSessionEmotionState.record_id == record.id)
            .first()
        )
        assert row is None
