"""Tests for exam → emotion bridge (feedback id=30: exam results never moved 4D emotion)."""

from modules.training.patient_ai.emotion.events import EmotionEventType
from modules.training.tools.exam_emotion import derive_exam_emotion_events


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
