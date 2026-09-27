"""Tests for physical exam operation handler and age-adaptive defaults."""

import json
from pathlib import Path

from modules.training.tools.physical_exam_rules import (
    _format_skin,
    _get_age_group,
    _get_default,
    _resolve_bp,
    _resolve_range,
    handle_operation,
)


class TestAgeGroup:
    def test_pediatric(self):
        assert _get_age_group({"patient_info": {"age": 3}}) == "pediatric"
        assert _get_age_group({"patient_info": {"age": 12}}) == "pediatric"

    def test_adult(self):
        assert _get_age_group({"patient_info": {"age": 13}}) == "adult"
        assert _get_age_group({"patient_info": {"age": 30}}) == "adult"
        assert _get_age_group({"patient_info": {"age": 64}}) == "adult"

    def test_elderly(self):
        assert _get_age_group({"patient_info": {"age": 65}}) == "elderly"
        assert _get_age_group({"patient_info": {"age": 80}}) == "elderly"

    def test_declared_reference_group_wins_over_speaker_age(self):
        """照护者代诉型病例：体征属于患儿，参考人群按病例声明，不按对话者年龄。"""
        case = {"patient_info": {"age": 30, "vitals_age_group": "pediatric"}}
        assert _get_age_group(case) == "pediatric"

    def test_unknown_declared_group_falls_back_to_age(self):
        """拼错的枚举不在闭集里 → 回落到按年龄推定（发布门禁另有规则点名它）。"""
        case = {"patient_info": {"age": 30, "vitals_age_group": "neonatal"}}
        assert _get_age_group(case) == "adult"

    def test_missing_age_defaults_to_adult(self):
        assert _get_age_group({}) == "adult"
        assert _get_age_group({"patient_info": {}}) == "adult"


class TestResolveRange:
    def test_simple_range(self):
        assert _resolve_range("36.8-37.2") == "37.0"

    def test_fixed_value(self):
        assert _resolve_range("36.8") == "36.8"

    def test_bp_range(self):
        result = _resolve_range("120/80-130/85")
        assert "125" in result
        assert "83" in result or "82" in result

    def test_empty(self):
        assert _resolve_range("") == ""


class TestResolveBP:
    def test_bp_midpoint(self):
        result = _resolve_bp("120/80-130/85")
        assert result in ("125/83", "125/82")

    def test_bp_odd_rounding(self):
        result = _resolve_bp("110/70-120/80")
        assert result in ("115/75",)


class TestFormatSkin:
    def test_string(self):
        assert _format_skin("皮肤温暖") == "皮肤温暖"

    def test_dict_returns_first_value(self):
        assert _format_skin({"right_foot": "溃烂创面", "left_foot": ""}) == "溃烂创面"

    def test_empty_dict_returns_none(self):
        assert _format_skin({}) is None

    def test_none_returns_none(self):
        assert _format_skin(None) is None


class TestGetDefault:
    def test_adult_temp(self):
        val = _get_default("temp", {"patient_info": {"age": 30}})
        assert float(val) > 36
        assert float(val) < 38

    def test_pediatric_hr_higher(self):
        adult = float(_get_default("hr", {"patient_info": {"age": 30}}))
        pediatric = float(_get_default("hr", {"patient_info": {"age": 5}}))
        assert pediatric > adult

    def test_elderly_bp_higher(self):
        adult = _get_default("bp", {"patient_info": {"age": 30}})
        elderly = _get_default("bp", {"patient_info": {"age": 70}})
        adult_sys = int(adult.split("/")[0])
        elderly_sys = int(elderly.split("/")[0])
        assert elderly_sys >= adult_sys

    def test_pain_defaults_to_zero(self):
        assert _get_default("pain", {}) == "0"

    def test_skin_default(self):
        assert "未见" in _get_default("skin", {})


def _cfg(config: dict) -> dict:
    """病例声明形状：``{"activities": {"physical_exam": {"config": …}}}``（docs/15 §四）。"""
    return {"activities": {"physical_exam": {"config": config}}}


class TestHandleOperation:
    def test_vital_from_activity_config(self):
        """Temperature resolved from the case-declared physical_exam config."""
        case = {**_cfg({"vital_signs": {"temperature": "36.8-37.2"}})}
        result = handle_operation("temp", case)
        assert result["value"] == "37.0"

    def test_vital_fallback_to_age_default(self):
        """HR falls back to age-appropriate default when not configured in the case."""
        case = {
            **_cfg({"vital_signs": {}}),  # no heart_rate
            "patient_info": {"age": 30},
        }
        result = handle_operation("hr", case)
        assert result["value"] != "—"
        assert float(result["value"]) > 50  # reasonable adult HR

    def test_skin_from_dict(self):
        """Skin inspection reads first value from nested dict."""
        case = {**_cfg({"skin": {"right_foot": "右足底溃烂创面", "left_foot": ""}})}
        result = handle_operation("skin", case)
        assert "溃烂" in result["value"]

    def test_skin_fallback(self):
        """Skin falls back to default when not configured."""
        case = {**_cfg({"vital_signs": {}})}
        result = handle_operation("skin", case)
        assert "未见" in result["value"]

    def test_pain_range_normalized_to_midpoint(self):
        """Pain resolved from physical_exam config vital_signs.pain_score — range 串必须归一化。

        旧实现直接返回 "4-6"，下游 _vitals_patch/情绪桥接 float() 抛错 → 场景体征与
        情绪事件双双静默丢失；恒真断言（"4" in v or "6" in v or v != "0"）固化了它。
        """
        case = {**_cfg({"vital_signs": {"pain_score": "4-6"}})}
        result = handle_operation("pain", case)
        assert float(result["value"]) == 5.0

    def test_seeded_cases_pain_is_numeric(self):
        """data/cases 里所有病例的疼痛读数都必须能被下游 float() 消费。"""
        cases_dir = Path(__file__).resolve().parents[2] / "data" / "cases"
        cases = sorted(cases_dir.glob("*.json"))
        assert cases
        for path in cases:
            case = json.loads(path.read_text(encoding="utf-8"))
            value = handle_operation("pain", case)["value"]
            assert float(value) >= 0, f"{path.name}: pain={value!r}"

    def test_pain_from_top_level(self):
        """Pain resolved from physical_exam config pain_score (top-level)."""
        case = {**_cfg({"pain_score": 3})}
        result = handle_operation("pain", case)
        assert result["value"] == "3"

    def test_pain_fallback(self):
        """Pain falls back to 0 when not configured."""
        case = {**_cfg({"vital_signs": {}})}
        result = handle_operation("pain", case)
        assert result["value"] == "0"

    def test_groups_format(self):
        """Groups format resolves vital signs correctly."""
        case = {
            **_cfg(
                {
                    "groups": [
                        {
                            "ops": [
                                {"id": "temp", "label": "体温", "unit": "°C", "source": "vital_signs.temperature"},
                                {"id": "custom_op", "label": "自定义", "unit": "", "source": "skin"},
                            ]
                        }
                    ],
                    "vital_signs": {"temperature": "37.0"},
                    "skin": "皮肤正常",
                }
            )
        }
        result = handle_operation("temp", case)
        assert result["value"] == "37.0"

        result = handle_operation("custom_op", case)
        assert "正常" in result["value"]

    def test_groups_fallback_to_default(self):
        """Groups-defined op falls back to default when source not configured."""
        case = {
            **_cfg(
                {
                    "groups": [
                        {
                            "ops": [
                                {"id": "temp", "label": "体温", "unit": "°C", "source": "vital_signs.temperature"},
                            ]
                        }
                    ],
                    "patient_info": {"age": 5},
                }
            )
        }
        result = handle_operation("temp", case)
        val = float(result["value"])
        assert val > 36
        assert val < 38


class TestCurrentVitals:
    """床旁读数以**患者当前状态**（``runtime_state.scene.vitals``）为准。

    病例 ``physical_exam.config`` 只是初始值：场景一旦被改（病程推进 / 任何状态变化），
    读到的值必须跟着场景走，否则屏幕上显示的值与量到的值会当场分叉。
    """

    def test_current_value_wins_over_case_config(self):
        case = {**_cfg({"vital_signs": {"spo2": "91-94"}})}  # 初始值中点 92.5
        result = handle_operation("spo2", case, current_vitals={"spo2": 88})
        assert result["value"] == "88"

    def test_interpretation_and_value_are_the_same_number(self):
        case = {**_cfg({"vital_signs": {"spo2": "91-94"}})}
        result = handle_operation("spo2", case, current_vitals={"spo2": 88})
        interp = result["interpretation"]
        assert interp["status"] == "low"
        assert "88" in interp["text"]
        assert "92.5" not in interp["text"]

    def test_bp_from_current_vitals(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"blood_pressure": "110/70-120/80"}})}
        result = handle_operation("bp", case, current_vitals={"bp_sys": 88, "bp_dia": 54})
        assert result["value"] == "88/54"
        assert result["interpretation"]["status"] == "low"
        assert "88/54" in result["interpretation"]["text"]

    def test_half_bp_falls_back_to_case_config(self):
        """半条血压（只有一项）不是可用的读数——回落病例配置，而不是硬凑。"""
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"blood_pressure": "110/70-120/80"}})}
        assert handle_operation("bp", case, current_vitals={"bp_sys": 88})["value"] == "115/75"

    def test_integral_float_does_not_drag_trailing_zero(self):
        """场景里的 temp 是 float：整数值必须与配置解析出的显示形态同形（38，而非 38.0）。"""
        case = {**_cfg({"vital_signs": {"temperature": "36.5-37.0"}})}
        assert handle_operation("temp", case, current_vitals={"temp": 38.0})["value"] == "38"
        assert handle_operation("temp", case, current_vitals={"temp": 38.5})["value"] == "38.5"

    def test_garbage_current_value_falls_back(self):
        case = {**_cfg({"vital_signs": {"spo2": "91-94"}})}
        for raw in ("—", "未测", None, ""):
            assert handle_operation("spo2", case, current_vitals={"spo2": raw})["value"] == "92.5"

    def test_partial_current_vitals_fall_back_per_indicator(self):
        case = {
            "patient_info": {"age": 40},
            **_cfg({"vital_signs": {"heart_rate": "88-100", "spo2": "96-98"}}),
        }
        vitals = {"spo2": 88}
        assert handle_operation("spo2", case, current_vitals=vitals)["value"] == "88"
        assert handle_operation("hr", case, current_vitals=vitals)["value"] == "94.0"  # 配置中点

    def test_pain_from_current_vitals(self):
        case = {**_cfg({"vital_signs": {"pain_score": "2-4"}})}
        result = handle_operation("pain", case, current_vitals={"pain": 9})
        assert result["value"] == "9"

    def test_empty_current_vitals_is_the_legacy_path(self):
        """场景还没有任何体征（未测量 / 病例未声明 scene.vitals）→ 与老行为逐字节一致。"""
        checks = [
            ({"patient_info": {"age": 40}, **_cfg({"vital_signs": {"temperature": "39.0"}})}, "hr"),
            ({"patient_info": {"age": 40}, **_cfg({"vital_signs": {"spo2": "90"}})}, "rr"),
            ({"patient_info": {"age": 40}, **_cfg({"vital_signs": {}})}, "temp"),
            ({"patient_info": {"age": 40}, **_cfg({"vital_signs": {"pain_score": "4-6"}})}, "pain"),
        ]
        for case, op in checks:
            assert handle_operation(op, case, current_vitals={}) == handle_operation(op, case)

    def test_unconfigured_and_unmeasured_keeps_age_default(self):
        """病例没配、场景也没有 → 仍是今天的年龄默认值（无代偿时成人 HR 中点 80）。"""
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {}})}
        assert handle_operation("hr", case, current_vitals={})["value"] == "80"

    def test_linked_default_follows_current_state(self):
        """代偿偏移按**当前**体征算：场景里已是低氧，未配置的 RR 就按低氧代偿。"""
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {}})}
        assert handle_operation("rr", case, current_vitals={})["value"] == "16"
        assert handle_operation("rr", case, current_vitals={"spo2": 90})["value"] == "21"


class TestPhysiologyLinkage:
    """联动网络：未配置体征按已配置体征的偏离做代偿偏移（确定性）。"""

    def test_fever_lifts_unconfigured_hr(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"temperature": "39.0"}})}
        # adult hr 默认中点 80；(39.0-37.2)*12 ≈ 22 → 102
        assert handle_operation("hr", case)["value"] == "102"

    def test_fever_respects_configured_hr(self):
        case = {
            "patient_info": {"age": 40},
            **_cfg({"vital_signs": {"temperature": "39.0", "heart_rate": "76"}}),
        }
        assert handle_operation("hr", case)["value"] == "76"

    def test_low_bp_raises_hr(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"blood_pressure": "90/60"}})}
        # adult 收缩压低限 110，低于 10+ → hr +25 → 105
        assert handle_operation("hr", case)["value"] == "105"

    def test_low_spo2_raises_rr(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"spo2": "90"}})}
        # adult rr 默认中点 16；(95-90) → 21
        assert handle_operation("rr", case)["value"] == "21"

    def test_severe_pain_raises_hr_and_bp(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"pain_score": "8"}})}
        assert handle_operation("hr", case)["value"] == "90"  # 80 + 10（应激）
        assert handle_operation("bp", case)["value"] == "128/82"  # 120/78 + 8/4

    def test_normal_config_no_offset(self):
        case = {
            "patient_info": {"age": 40},
            **_cfg({"vital_signs": {"temperature": "36.8", "heart_rate": "76"}}),
        }
        assert handle_operation("hr", case)["value"] == "76"
        assert handle_operation("rr", case)["value"] == "16"  # 无偏移 → 默认中点

    def test_deterministic_same_input_same_output(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"temperature": "39.0"}})}
        assert handle_operation("hr", case)["value"] == handle_operation("hr", case)["value"]


class TestInterpretation:
    """解读提示：status + 非答案式教学文案（前端按模式门控显示）。"""

    def test_high_temp_interpretation(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"temperature": "39.0"}})}
        interp = handle_operation("temp", case)["interpretation"]
        assert interp["status"] == "high"
        assert "高于参考范围" in interp["text"]

    def test_normal_hr_interpretation(self):
        case = {"patient_info": {"age": 40}}
        interp = handle_operation("hr", case)["interpretation"]
        assert interp["status"] == "normal"
        assert "参考范围" in interp["text"]

    def test_bp_interpretation(self):
        case = {"patient_info": {"age": 40}, **_cfg({"vital_signs": {"blood_pressure": "150/95"}})}
        interp = handle_operation("bp", case)["interpretation"]
        assert interp["status"] == "high"

    def test_skin_no_interpretation(self):
        case = {"patient_info": {"age": 40}}
        assert "interpretation" not in handle_operation("skin", case)

    def test_elderly_range_applied(self):
        # 老年 spo2 参考下限 93：94% 属于正常
        case = {"patient_info": {"age": 70}, **_cfg({"vital_signs": {"spo2": "94"}})}
        assert handle_operation("spo2", case)["interpretation"]["status"] == "normal"
