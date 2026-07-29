import pytest  # noqa: F401

from core.gender import normalize_gender
from infra.tts.mapper import resolve_voice_type


class TestNormalizeGender:
    def test_chinese_male(self):
        assert normalize_gender("男") == "男"
        assert normalize_gender("男性") == "男"

    def test_chinese_female(self):
        assert normalize_gender("女") == "女"
        assert normalize_gender("女性") == "女"

    def test_english_male(self):
        assert normalize_gender("male") == "男"
        assert normalize_gender("M") == "男"
        assert normalize_gender("Male") == "男"

    def test_english_female(self):
        assert normalize_gender("female") == "女"
        assert normalize_gender("F") == "女"
        assert normalize_gender("Female") == "女"

    def test_whitespace(self):
        assert normalize_gender(" 男 ") == "男"
        assert normalize_gender(" male ") == "男"

    def test_none(self):
        assert normalize_gender(None) is None
        assert normalize_gender("") is None

    def test_unknown(self):
        assert normalize_gender("other") is None
        assert normalize_gender("unknown") is None


class TestResolveVoiceType:
    def test_override_highest_priority(self):
        result = resolve_voice_type(None, 30, "男", override="zh_male_wennuan_bigtts")
        assert result == "zh_male_wennuan_bigtts"

    def test_invalid_override_falls_through(self):
        result = resolve_voice_type(None, 30, "男", override="nonexistent")
        assert result == "zh_male_wennuan_bigtts"

    def test_explicit_voice_type(self):
        result = resolve_voice_type("zh_female_wenrou_bigtts", None, None)
        assert result == "zh_female_wenrou_bigtts"

    def test_invalid_explicit_falls_through(self):
        result = resolve_voice_type("nonexistent", 30, "男")
        assert result == "zh_male_wennuan_bigtts"

    def test_demographic_child_male(self):
        result = resolve_voice_type(None, 8, "男")
        assert result == "zh_male_qingse_bigtts"

    def test_demographic_child_female(self):
        result = resolve_voice_type(None, 5, "女")
        assert result == "zh_female_qingxin_bigtts"

    def test_demographic_elder_female(self):
        result = resolve_voice_type(None, 72, "女")
        assert result == "zh_female_wenrou_bigtts"

    def test_demographic_young_male(self):
        result = resolve_voice_type(None, 22, "男")
        assert result == "zh_male_qingse_bigtts"

    def test_demographic_fallback_unknown_gender(self):
        result = resolve_voice_type(None, 30, None)
        assert result == "zh_female_vv_uranus_bigtts"

    def test_override_beats_everything(self):
        result = resolve_voice_type(
            "zh_female_wenrou_bigtts",
            22,
            "男",
            override="zh_female_vv_uranus_bigtts",
        )
        assert result == "zh_female_vv_uranus_bigtts"
