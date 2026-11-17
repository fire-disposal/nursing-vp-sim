"""Unit tests — TTS 2.0 speaker library & emotion instructions (no network).

Covers the two invariants that make the emotion wiring real:
  * every dominant_state label maps to a non-empty instruction,
  * every built-in speaker is a TTS 2.0 (``_uranus_``) voice, since only that
    family honours ``context_texts``.
"""

import pytest

from infra.tts import mapper

# 10 labels: every value resolve_dominant_state can return (9) + neutral.
ALL_DOMINANT_STATES = [
    "open_trusting",
    "trusting_anxious",
    "irritated",
    "anxious_cooperative",
    "anxious_guarded",
    "withdrawn",
    "defensive",
    "relaxed",
    "neutral",
]

DEMOGRAPHIC_SLOTS = [
    "child_male",
    "child_female",
    "male_young",
    "male_middle",
    "male_elder",
    "female_young",
    "female_middle",
    "female_elder",
]


class TestEmotionInstructions:
    @pytest.mark.parametrize("state", ALL_DOMINANT_STATES)
    def test_every_label_has_one_instruction(self, state):
        texts = mapper.resolve_context_texts(state)
        assert isinstance(texts, list)
        assert len(texts) == 1
        assert texts[0].strip() == texts[0]
        assert texts[0]

    def test_labels_are_distinct_instructions(self):
        rendered = [mapper.resolve_context_texts(s)[0] for s in ALL_DOMINANT_STATES]
        # 十个标签实际产出十条不同指令，避免"看似映射、实际同一条"的假覆盖
        assert len(set(rendered)) == len(ALL_DOMINANT_STATES)

    @pytest.mark.parametrize("state", ALL_DOMINANT_STATES)
    def test_instruction_is_short_patient_tone(self, state):
        text = mapper.resolve_context_texts(state)[0]
        assert text.startswith("语气")
        assert len(text) <= 60

    def test_anxiety_pair_distinguished(self):
        cooperative = mapper.resolve_context_texts("anxious_cooperative")[0]
        guarded = mapper.resolve_context_texts("anxious_guarded")[0]
        assert "焦虑" in cooperative
        assert "配合" in cooperative
        assert "焦虑" in guarded
        assert "戒备" in guarded
        assert cooperative != guarded

    def test_withdrawn_and_defensive_are_guarded(self):
        assert "疏离" in mapper.resolve_context_texts("withdrawn")[0]
        assert "戒备" in mapper.resolve_context_texts("defensive")[0]

    @pytest.mark.parametrize("state", ["open_trusting", "relaxed"])
    def test_warm_labels(self, state):
        assert "温和" in mapper.resolve_context_texts(state)[0]

    def test_irritated_is_restrained(self):
        text = mapper.resolve_context_texts("irritated")[0]
        assert "不耐烦" in text
        assert "克制" in text

    def test_neutral_is_calm(self):
        assert mapper.resolve_context_texts("neutral") == [mapper.resolve_context_texts(None)[0]]
        assert "平静" in mapper.resolve_context_texts("neutral")[0]

    @pytest.mark.parametrize("label", ["unknown_state", "", None, "  "])
    def test_unknown_label_falls_back_to_neutral(self, label):
        assert mapper.emotion_label(label) == "neutral"
        assert mapper.resolve_context_texts(label) == mapper.resolve_context_texts("neutral")

    def test_label_is_stripped(self):
        assert mapper.emotion_label(" irritated ") == "irritated"


class TestSpeakerLibrary:
    def test_every_builtin_speaker_is_tts2(self):
        for slot, speaker in mapper._BUILTIN_SPEAKER_LIBRARY.items():
            assert "_uranus_" in speaker, f"{slot} -> {speaker} 不是 TTS 2.0 音色"

    def test_fallback_is_vivi(self):
        assert mapper.DEFAULT_SPEAKER == "zh_female_vv_uranus_bigtts"
        assert mapper._BUILTIN_SPEAKER_LIBRARY["fallback"] == mapper.DEFAULT_SPEAKER

    def test_eight_demographic_slots_present(self):
        for slot in DEMOGRAPHIC_SLOTS:
            assert slot in mapper._BUILTIN_SPEAKER_LIBRARY

    def test_gender_consistent_slots(self):
        lib = mapper._BUILTIN_SPEAKER_LIBRARY
        for slot in ("child_male", "male_young", "male_middle", "male_elder"):
            assert lib[slot].startswith("zh_male_")
        for slot in ("child_female", "female_young", "female_middle", "female_elder"):
            assert lib[slot].startswith("zh_female_")

    def test_slots_do_not_collapse_to_one_voice(self):
        lib = mapper._BUILTIN_SPEAKER_LIBRARY
        assert len({lib[s] for s in DEMOGRAPHIC_SLOTS}) == len(DEMOGRAPHIC_SLOTS)

    def test_demographic_resolution_uses_uranus(self):
        assert mapper.resolve_voice_type(None, 8, "男") == mapper._BUILTIN_SPEAKER_LIBRARY["child_male"]
        assert mapper.resolve_voice_type(None, 8, "女") == mapper._BUILTIN_SPEAKER_LIBRARY["child_female"]
        assert mapper.resolve_voice_type(None, 20, "女") == mapper._BUILTIN_SPEAKER_LIBRARY["female_young"]
        assert mapper.resolve_voice_type(None, 45, "女") == mapper._BUILTIN_SPEAKER_LIBRARY["female_middle"]
        assert mapper.resolve_voice_type(None, 70, "女") == mapper._BUILTIN_SPEAKER_LIBRARY["female_elder"]
        assert mapper.resolve_voice_type(None, 30, "男") == mapper._BUILTIN_SPEAKER_LIBRARY["male_middle"]
        assert mapper.resolve_voice_type(None, 72, "男") == mapper._BUILTIN_SPEAKER_LIBRARY["male_elder"]
        assert mapper.resolve_voice_type(None, None, None) == mapper.DEFAULT_SPEAKER

    def test_db_override_wins_and_stays_valid(self):
        custom = {"female_middle": "zh_female_wenroushunv_uranus_bigtts"}
        assert mapper.resolve_voice_type(None, 45, "女", speaker_library=custom) == custom["female_middle"]
        # 未覆盖的槽位仍是内置默认
        assert (
            mapper.resolve_voice_type(None, 8, "男", speaker_library=custom)
            == (mapper._BUILTIN_SPEAKER_LIBRARY["child_male"])
        )
