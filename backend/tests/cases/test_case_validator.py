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
