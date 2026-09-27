"""病例校验器规则测试 — 每条规则 1 正例 + 1 反例。

反例夹具优先使用仍在内置语料里的病例（case1/case3/case4/case9）；
规则需要特定年龄/形态时在合法病例上覆盖字段构造夹具（见 ``_pediatric_base``），
这样规则的覆盖度不再取决于某一份内置内容是否存在。
"""

import json
from pathlib import Path

from modules.cases.validator import validate_case

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cases"


def _load(name: str) -> dict:
    return json.loads((CASES_DIR / f"{name}.json").read_text(encoding="utf-8"))


# ── 时间线：主诉时长 vs 示例起病锚点 ─────────────────────────────────────


def test_time_anchor_consistent_after_fix():
    c = _load("case3")  # 主诉 18h，示例已改"昨晚就开始疼了"
    assert validate_case(c).ok()


def test_time_anchor_mismatch_detected():
    c = _load("case3")
    c = json.loads(json.dumps(c))  # deep copy
    ex = c["example_dialogues"][1]
    ex["answer"] = ex["answer"].replace("昨晚就开始疼了", "今天早上才开始疼的")
    r = validate_case(c)
    assert not r.ok()
    assert any("时间线" in i.message for i in r.errors)


# ── 症状否定 ─────────────────────────────────────────────────────────────


def test_symptom_negation_consistent_after_fix():
    c = _load("case3")  # 现病史"无明显呕吐"，示例"但没吐出来"（否定前缀豁免）
    assert validate_case(c).ok()


def test_symptom_negation_contradiction_detected():
    c = json.loads(json.dumps(_load("case3")))
    c["example_dialogues"][2]["answer"] = "有，吐了两回了。"
    r = validate_case(c)
    assert any("呕吐" in i.message for i in r.errors)


# ── 人物关系 ─────────────────────────────────────────────────────────────


def test_spouse_dead_consistent_after_fix():
    c = _load("case9")  # 示例已改"邻居/大女儿"
    assert validate_case(c).ok()


def test_spouse_dead_contradiction_detected():
    c = json.loads(json.dumps(_load("case9")))
    c["example_dialogues"][0]["answer"] = "还是老伴把我扶起来的。"
    r = validate_case(c)
    assert any("老伴" in i.message or "配偶" in i.message for i in r.errors)


# ── 年龄-生理 ────────────────────────────────────────────────────────────


def _pediatric_base() -> dict:
    """前囟规则的夹具：在形态合法的病例上覆盖年龄，不依赖某份内置儿科内容。

    原先借用内置儿科病例（``case6.json``，3 岁幼儿）当夹具；该病例零练习记录，
    已随病例库收敛删除（data 迁移 ``c2d3e4f5a6b7``）。规则本身只依赖
    「``patient_info.age`` ≥ 2 且文本出现前囟/后囟」，用年龄覆盖即可保持覆盖度，
    且不再因某份内置内容的有无而失效。
    """
    c = json.loads(json.dumps(_load("case1")))
    c["patient_info"]["age"] = 3
    return c


def test_fontanelle_removed():
    assert validate_case(_pediatric_base()).ok()


def test_fontanelle_detected():
    c = _pediatric_base()
    c["activities"]["physical_exam"]["config"]["skin"] = {"全身": "皮肤潮红，弹性可，前囟平坦"}
    r = validate_case(c)
    assert any("前囟" in i.message for i in r.errors)


# ── 场景（scene）形状与取值 ──────────────────────────────────────────────


def _with_scene(scene: dict) -> dict:
    c = json.loads(json.dumps(_load("case1")))
    c["scene"] = scene
    return c


_VALID_SCENE = {
    "environment": {"type": "er", "time_of_day": "night", "equipment": ["氧气管"], "noise_level": "moderate"},
    "patient": {"position": "semi-recumbent", "consciousness": "alert", "visible_symptoms": ["喘息"]},
    "vitals": {"hr": 96, "rr": 24, "spo2": 92, "temp": 37.8, "bp_sys": 142, "bp_dia": 88, "pain": 3},
    "phase": "initial_assessment",
}


def test_scene_absent_is_ok():
    """场景可选：不声明 scene 的病例照常通过（当前多数内置病例如此）。"""
    assert validate_case(_load("case1")).ok()


def test_valid_scene_passes():
    assert validate_case(_with_scene(_VALID_SCENE)).ok()


def test_scene_wrong_enum_is_error():
    scene = json.loads(json.dumps(_VALID_SCENE))
    scene["environment"]["type"] = "icu2"
    r = validate_case(_with_scene(scene))
    assert any("scene 形状不合法" in i.message and "scene.environment.type" in i.field for i in r.errors)


def test_scene_string_vital_is_error():
    scene = json.loads(json.dumps(_VALID_SCENE))
    scene["vitals"]["hr"] = "很快"
    r = validate_case(_with_scene(scene))
    assert any("scene.vitals.hr" in i.field for i in r.errors)


def test_scene_implausible_vital_is_error():
    """笔误型数值（spo2=920）必须发布前报错——否则它会原样进患者上下文。"""
    scene = json.loads(json.dumps(_VALID_SCENE))
    scene["vitals"]["spo2"] = 920
    r = validate_case(_with_scene(scene))
    assert any("生理范围" in i.message and "scene.vitals.spo2" in i.field for i in r.errors)


def test_vitals_age_group_absent_is_ok():
    """参考人群可选：不声明就按 patient_info.age 推定（既有病例全部如此）。"""
    assert validate_case(_load("case1")).ok()


def test_vitals_age_group_declared_is_ok():
    c = _load("case1")
    c["patient_info"]["vitals_age_group"] = "pediatric"  # 场景：照护者代诉型
    assert validate_case(c).ok()


def test_vitals_age_group_invalid_is_error():
    """拼错的枚举必须发布前报错——运行期只会静默回落，学生看到的是错误结论。"""
    c = _load("case1")
    c["patient_info"]["vitals_age_group"] = "neonatal"
    r = validate_case(c)
    assert any(i.field == "patient_info.vitals_age_group" and "不合法" in i.message for i in r.errors)


def test_scene_non_object_is_error():
    r = validate_case(_with_scene(["不是对象"]))
    assert any(i.field == "scene" and "必须是对象" in i.message for i in r.errors)


# ── 情绪立绘（患者表现层的情绪立绘映射） ─────────────────────────────────


def test_portrait_states_absent_is_ok():
    """立绘可选：不声明 = 只有单张立绘（既有病例全部如此）。"""
    assert validate_case(_load("case1")).ok()


def test_portrait_states_declared_is_ok():
    c = _load("case1")
    c["patient_info"]["portrait_states"] = {
        "anxious": "https://cdn.example.com/wang-anxious.png",
        "neutral": "/media/cases/wang-neutral.png",
    }
    assert validate_case(c).ok()


def test_portrait_states_unknown_emotion_is_error():
    """情绪键拼错必须发布前报错——运行期只会静默回落单张立绘，那张图永远不会出现。"""
    c = _load("case1")
    c["patient_info"]["portrait_states"] = {"worried": "https://cdn.example.com/worried.png"}
    r = validate_case(c)
    assert any(i.field == "patient_info.portrait_states" and "未知情绪键" in i.message for i in r.errors)
    # 提示要给出可选键，作者才知道该改成什么
    assert any("relaxed" in i.fix_hint for i in r.errors)


def test_portrait_states_non_string_value_is_error():
    c = _load("case1")
    c["patient_info"]["portrait_states"] = {"anxious": ["a.png"], "neutral": "   "}
    r = validate_case(c)
    assert {i.field for i in r.errors} >= {
        "patient_info.portrait_states.anxious",
        "patient_info.portrait_states.neutral",
    }
    assert all("必须是非空字符串" in i.message for i in r.errors if i.field.startswith("patient_info.portrait_states."))


def test_portrait_states_non_object_is_error():
    c = _load("case1")
    c["patient_info"]["portrait_states"] = ["anxious"]
    r = validate_case(c)
    assert any(i.field == "patient_info.portrait_states" and "必须是对象" in i.message for i in r.errors)


# ── 数量约束 ─────────────────────────────────────────────────────────────


def test_example_count_fixed():
    c = _load("case4")  # 已补到 3 条
    assert validate_case(c).ok()


def test_example_count_too_few():
    c = json.loads(json.dumps(_load("case4")))
    c["example_dialogues"] = c["example_dialogues"][:2]
    r = validate_case(c)
    assert any("example_dialogues 数量" in i.message for i in r.errors)


# ── 死字段（字段过细分治理）─────────────────────────────────────────────


def test_consumed_optional_fields_do_not_warn():
    c = _load("case1")
    c["voice_override"] = "custom-speaker"
    r = validate_case(c)
    assert not [i for i in r.warnings if i.field in {"activities", "voice_override"}]


def test_legacy_tools_field_warns_after_migration():
    """迁移后残留的旧形状（tools / exam_anchors）必须被审计点名。"""
    c = json.loads(json.dumps(_load("case1")))
    c["tools"] = {"physical_exam": {"vital_signs": {"temperature": "37℃"}}}
    c["exam_anchors"] = {"vital_signs": {"temperature": "37℃"}}
    r = validate_case(c)
    warned = {i.field for i in r.warnings}
    assert {"tools", "exam_anchors"} <= warned


def test_unregistered_field_still_warns():
    c = _load("case1")
    c["unregistered_case_setting"] = True
    r = validate_case(c)
    assert any(i.field == "unregistered_case_setting" for i in r.warnings)


def test_retired_field_still_warns():
    c = _load("case1")
    c["capabilities"] = ["physical_exam"]
    r = validate_case(c)
    assert any(i.field == "capabilities" for i in r.warnings)


# ── Activity 声明质量门禁（docs/15 §四/§十）──────────────────────────────


def _activity_case(activities: object) -> dict:
    c = json.loads(json.dumps(_load("case1")))
    c["activities"] = activities
    return c


def test_unknown_activity_id_is_error():
    """病例声明了内核不认识的 activity → 发布即失败，不允许静默不可达。"""
    r = validate_case(_activity_case({"telepathy": {"config": {}}}))
    assert any("内核不认识的 activity" in i.message for i in r.errors)


def test_missing_config_is_error():
    r = validate_case(_activity_case({"physical_exam": {}}))
    assert any("缺少 config" in i.message for i in r.errors)


def test_empty_physical_exam_config_is_error():
    r = validate_case(_activity_case({"physical_exam": {"config": {}}}))
    assert any("必须是非空对象" in i.message for i in r.errors)


def test_physical_exam_config_without_any_source_is_error():
    r = validate_case(_activity_case({"physical_exam": {"config": {"note": "无体征"}}}))
    assert any("无法解析任何查体项" in i.message for i in r.errors)


def test_quiz_without_questions_is_error():
    r = validate_case(_activity_case({"quiz": {"config": {"title": "空测验", "questions": []}}}))
    assert any("非空 questions" in i.message for i in r.errors)


def test_declared_activities_pass():
    c = _load("case1")
    r = validate_case(c)
    assert r.ok()
    assert not [i for i in r.issues if i.field.startswith("activities")]


def test_nursing_diagnosis_declaration_warns_not_productized():
    """该 Activity 只写 runtime_state、无正式产物（docs/15 §三/§十）。"""
    r = validate_case(_activity_case({"nursing_diagnosis": {"config": {"enabled": True}}}))
    assert any("无正式产物" in i.message for i in r.warnings)
    assert r.ok()


def test_missing_activities_declaration_is_error():
    c = json.loads(json.dumps(_load("case1")))
    del c["activities"]
    r = validate_case(c)
    assert any("缺少 activities 声明" in i.message for i in r.errors)


# ── 交卷门禁的病例声明（docs/15 §五）─────────────────────────────────────


def test_completion_declaration_accepted():
    c = _load("case1")
    c["completion"] = {"required_artifacts": ["nursing_record"]}
    assert validate_case(c).ok()


def test_completion_declaration_can_waive_the_gate():
    """本次教学不要求先提交护理记录：声明空列表是**合法**的，不是错误。"""
    c = _load("case1")
    c["completion"] = {"required_artifacts": []}
    assert validate_case(c).ok()


def test_completion_declaration_unknown_artifact_is_error():
    """拼错的产物名必须在发布期报错：运行期解析器会静默忽略，学生那边就没有门禁。"""
    c = _load("case1")
    c["completion"] = {"required_artifacts": ["nursing_recrod"]}
    r = validate_case(c)
    assert any("未登记的产物" in i.message and i.field == "completion.required_artifacts" for i in r.errors)


def test_completion_declaration_wrong_shape_is_error():
    c = _load("case1")
    c["completion"] = {"required_artifacts": "nursing_record"}
    r = validate_case(c)
    assert any("必须是字符串列表" in i.message for i in r.errors)


def test_completion_declaration_unknown_key_is_error():
    c = _load("case1")
    c["completion"] = {"require_nursing_record": True}
    r = validate_case(c)
    assert any("未知键" in i.message for i in r.errors)
