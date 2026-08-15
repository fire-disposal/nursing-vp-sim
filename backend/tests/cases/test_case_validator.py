"""病例校验器规则测试 — 每条规则 1 正例 + 1 反例。

反例夹具直接使用修复后的内置病例（case3/case6/case9），
规则活着 = 数据不再回归。
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


def test_fontanelle_removed():
    c = _load("case6")  # 3 岁，前囟已删除
    assert validate_case(c).ok()


def test_fontanelle_detected():
    c = json.loads(json.dumps(_load("case6")))
    c["tools"]["physical_exam"]["skin"] = {"全身": "皮肤潮红，弹性可，前囟平坦"}
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


def test_dead_field_detected():
    c = json.loads(json.dumps(_load("case1")))
    c["exam_anchors"] = {"legacy": True}
    r = validate_case(c)
    assert any("无消费端" in i.message or "legacy" in i.message for i in r.warnings)


def test_no_dead_fields_in_builtin():
    from modules.cases.validator import CONSUMED_FIELDS

    c = _load("case1")
    unknown = [k for k in c if k not in CONSUMED_FIELDS and k != "variant_of"]
    assert unknown == [], f"未登记消费端的字段: {unknown}"
