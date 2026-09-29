"""教学蓝图（``blueprint``）的发布门禁。

纯函数层测试：夹具是 dict 载荷，直接喂 :func:`validate_case` / :func:`validate_cases`，
不起库、不走 HTTP（写路径的 schema 校验另有测试）。每条规则 1 正例 + 1 反例。
"""

from __future__ import annotations

import json

from modules.cases.validator import (
    BLUEPRINT_FIELD,
    CONSUMED_FIELDS,
    PRACTICE_ROLE,
    TRANSFER_ROLE,
    validate_case,
    validate_cases,
)

#: 一份结构完整的问诊病例 + 蓝图：线索 id 与 required_inquiries 原文都能被覆盖清单引用。
BLUEPRINT_CASE: dict = {
    "name": "蓝图病例",
    "workflow": "history_taking",
    "chief_complaint": "咳嗽三天",
    "required_inquiries": ["咳嗽持续多久了", "有没有痰"],
    "example_dialogues": [
        {"q": "哪不舒服", "a": "咳嗽"},
        {"q": "多久了", "a": "三天了"},
        {"q": "有痰吗", "a": "有一点"},
    ],
    "activities": {"physical_exam": {"config": {"vital_signs": {"temp": "36.5-37.2"}}}},
    "blueprint": {
        "learning_objectives": ["完成咳嗽病史采集并区分急性与慢性"],
        "prerequisites": "能进行开放式提问",
        "clues": [
            {"id": "clue.cough_duration", "label": "咳嗽病程", "source": "inquiry", "significance": "判断急性/慢性"},
            {"id": "clue.sputum", "label": "痰液性状", "source": "inquiry"},
        ],
        "must_cover": ["clue.cough_duration", "有没有痰"],
        "situational": ["clue.sputum"],
        "key_omissions": ["有没有痰"],
        "acceptable_evidence": ["先问病程再问痰液性状"],
        "typical_errors": ["只问咳嗽不问病程"],
        "not_applicable_items": ["comm_01"],
        "intervention_observable": False,
        "family_id": "",
        "variant_role": None,
        "transfer_of": "",
        "review": {"editorial_state": "draft", "reviewer": "", "reviewed_at": "", "note": ""},
    },
}


def _payload(**overrides) -> dict:
    """写路径入参：一次深拷贝，overrides 里给 ``None`` 表示删掉该键。"""
    data = json.loads(json.dumps(BLUEPRINT_CASE))
    for key, value in overrides.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
    return data


def _with_blueprint(**overrides) -> dict:
    """改蓝图子键；给 ``None`` 表示删掉该子键。"""
    data = _payload()
    for key, value in overrides.items():
        if value is None:
            data[BLUEPRINT_FIELD].pop(key, None)
        else:
            data[BLUEPRINT_FIELD][key] = value
    return data


def _errors(report) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for issue in report.errors:
        grouped.setdefault(issue.field, []).append(issue.message)
    return grouped


def _messages(report) -> str:
    return " | ".join(i.message for i in report.warnings)


# ── 基线 + 字段登记（规则 8）─────────────────────────────────────────────


class TestBlueprintBaseline:
    def test_well_formed_blueprint_passes_the_gate(self):
        report = validate_case(_payload())
        assert report.errors == []
        assert report.warnings == []

    def test_blueprint_is_a_registered_consumed_field(self):
        """**不**登记就是「未登记消费端」假警告 —— 蓝图必须是已接入字段。"""
        assert BLUEPRINT_FIELD in CONSUMED_FIELDS
        assert "未登记消费端" not in _messages(validate_case(_payload()))

    def test_absent_blueprint_stays_clean(self):
        report = validate_case(_payload(blueprint=None))
        assert report.errors == []
        assert report.warnings == []


# ── 规则 1：learning_objectives ──────────────────────────────────────────


class TestBlueprintObjectives:
    def test_empty_learning_objectives_is_rejected(self):
        assert "blueprint.learning_objectives" in _errors(validate_case(_with_blueprint(learning_objectives=[])))

    def test_blank_only_learning_objectives_is_rejected(self):
        data = _with_blueprint(learning_objectives=["   "])
        assert "blueprint.learning_objectives" in _errors(validate_case(data))

    def test_declared_objective_passes(self):
        data = _with_blueprint(learning_objectives=["识别急性咳嗽的警示征象"])
        assert validate_case(data).errors == []


# ── 规则 2：线索 id 唯一且非空 ───────────────────────────────────────────


class TestBlueprintClueIds:
    def test_duplicate_clue_id_is_rejected(self):
        data = _with_blueprint(
            clues=[
                {"id": "clue.a", "label": "病程", "source": "inquiry"},
                {"id": "clue.a", "label": "痰液", "source": "initial"},
            ]
        )
        grouped = _errors(validate_case(data))
        assert "blueprint.clues[1].id" in grouped
        assert "重复" in grouped["blueprint.clues[1].id"][0]

    def test_empty_clue_id_is_rejected(self):
        data = _with_blueprint(clues=[{"id": "  ", "label": "病程", "source": "inquiry"}])
        assert "blueprint.clues[0].id" in _errors(validate_case(data))

    def test_distinct_clue_ids_pass(self):
        data = _with_blueprint(
            clues=[
                {"id": "clue.a", "label": "病程", "source": "inquiry"},
                {"id": "clue.b", "label": "痰液", "source": "exam"},
            ],
            must_cover=["clue.a", "有没有痰"],
            situational=["clue.b"],
        )
        assert validate_case(data).errors == []


# ── 规则 3：覆盖清单必须解析到线索 id 或 required_inquiries 原文 ─────────


class TestBlueprintReferences:
    def test_must_cover_entry_is_named_with_its_json_path(self):
        data = _with_blueprint(must_cover=["clue.typo"])
        grouped = _errors(validate_case(data))
        assert "clue.typo" in grouped["blueprint.must_cover[0]"][0]

    def test_situational_entry_is_named_with_its_json_path(self):
        grouped = _errors(validate_case(_with_blueprint(situational=["clue.typo"])))
        assert "blueprint.situational[0]" in grouped

    def test_key_omission_entry_is_named_with_its_json_path(self):
        grouped = _errors(validate_case(_with_blueprint(key_omissions=["clue.typo"])))
        assert "blueprint.key_omissions[0]" in grouped

    def test_clue_ids_and_inquiry_text_both_resolve(self):
        data = _with_blueprint(
            must_cover=["clue.sputum", "咳嗽持续多久了"],
            situational=["clue.cough_duration"],
            key_omissions=["有没有痰"],
        )
        assert validate_case(data).errors == []


# ── 规则 4：not_applicable_items 必须是真 rubric 条目 / 不得与遗漏矛盾 ───


class TestBlueprintNotApplicableItems:
    def test_unknown_rubric_item_is_rejected(self):
        grouped = _errors(validate_case(_with_blueprint(not_applicable_items=["comm_99"])))
        assert "comm_99" in grouped["blueprint.not_applicable_items[0]"][0]

    def test_real_rubric_item_passes(self):
        data = _with_blueprint(not_applicable_items=["comm_01", "hist_05"])
        assert validate_case(data).errors == []

    def test_nursing_record_item_is_valid_when_activity_enabled(self):
        """启用 nursing_record 的病例可以声明 ``nr_*`` 不适用 —— 没有干预机会时最该声明的一条。"""
        data = _with_blueprint(not_applicable_items=["nr_05"])
        data["activities"] = {
            "physical_exam": {"config": {"vital_signs": {"temp": "36.5-37.2"}}},
            "nursing_record": {"config": {"adpie": ["subjective", "objective", "assessment", "plan", "evaluation"]}},
        }
        assert validate_case(data).errors == []

    def test_nursing_record_item_is_rejected_when_activity_absent(self):
        """未启用 nursing_record 的病例里 ``nr_*`` 不是真条目 → 引用悬空必须报错。"""
        data = _with_blueprint(not_applicable_items=["nr_05"])
        data["activities"] = {"physical_exam": {"config": {}}}
        assert "blueprint.not_applicable_items[0]" in _errors(validate_case(data))

    def test_item_declared_both_not_applicable_and_key_omission_is_a_contradiction(self):
        data = _with_blueprint(not_applicable_items=["comm_01"], key_omissions=["comm_01"])
        messages = _errors(validate_case(data))["blueprint.not_applicable_items[0]"]
        assert any("矛盾" in message for message in messages)


# ── 规则 5a：家族角色自洽（单病例）──────────────────────────────────────


class TestBlueprintVariantDeclaration:
    def test_transfer_without_transfer_of_is_rejected(self):
        data = _with_blueprint(variant_role=TRANSFER_ROLE, family_id="fam.cough", transfer_of="")
        assert "blueprint.transfer_of" in _errors(validate_case(data))

    def test_transfer_without_family_is_rejected(self):
        data = _with_blueprint(variant_role=TRANSFER_ROLE, family_id="  ", transfer_of="练习病例A")
        assert "blueprint.family_id" in _errors(validate_case(data))

    def test_practice_without_family_is_rejected(self):
        data = _with_blueprint(variant_role=PRACTICE_ROLE, family_id="")
        assert "blueprint.family_id" in _errors(validate_case(data))

    def test_complete_transfer_declaration_passes(self):
        data = _with_blueprint(variant_role=TRANSFER_ROLE, family_id="fam.cough", transfer_of="练习病例A")
        assert validate_case(data).errors == []

    def test_complete_practice_declaration_passes(self):
        data = _with_blueprint(variant_role=PRACTICE_ROLE, family_id="fam.cough")
        assert validate_case(data).errors == []


# ── 规则 5b：家族角色自洽（跨病例）──────────────────────────────────────


class TestBlueprintFamilyConsistency:
    @staticmethod
    def _pair(practice_role=PRACTICE_ROLE) -> dict[str, dict]:
        practice = _payload(name="练习病例A")
        practice[BLUEPRINT_FIELD]["family_id"] = "fam.cough"
        practice[BLUEPRINT_FIELD]["variant_role"] = practice_role
        transfer = _payload(name="迁移变式A")
        transfer[BLUEPRINT_FIELD]["family_id"] = "fam.cough"
        transfer[BLUEPRINT_FIELD]["variant_role"] = TRANSFER_ROLE
        transfer[BLUEPRINT_FIELD]["transfer_of"] = "练习病例A"
        return {"practice": practice, "transfer": transfer}

    def test_transfer_pointing_at_a_practice_case_is_accepted(self):
        report = validate_cases(self._pair())["transfer"]
        assert report.warnings == []

    def test_transfer_pointing_at_a_non_practice_case_is_warned(self):
        cases = self._pair(practice_role=None)
        report = validate_cases(cases)["transfer"]
        assert [i.field for i in report.warnings] == ["blueprint.transfer_of"]
        assert "练习病例A" in report.warnings[0].message
        assert report.errors == []


# ── 规则 6：teacher_reviewed 必须留审阅人 ───────────────────────────────


class TestBlueprintReview:
    def test_teacher_reviewed_without_reviewer_is_rejected(self):
        data = _with_blueprint(review={"editorial_state": "teacher_reviewed", "reviewer": "  "})
        assert "blueprint.review.reviewer" in _errors(validate_case(data))

    def test_teacher_reviewed_with_reviewer_passes(self):
        data = _with_blueprint(
            review={"editorial_state": "teacher_reviewed", "reviewer": "王护士长", "reviewed_at": "2026-09-01"}
        )
        assert validate_case(data).errors == []

    def test_draft_without_reviewer_is_accepted(self):
        data = _with_blueprint(review={"editorial_state": "draft", "reviewer": ""})
        assert validate_case(data).errors == []


# ── 规则 7：蓝图只属于 history_taking 病例 ───────────────────────────────


class TestBlueprintWorkflowScope:
    def test_blueprint_on_clinical_reasoning_case_is_rejected(self):
        data = _payload(workflow="clinical_reasoning")
        messages = _errors(validate_case(data))["workflow"]
        assert any("blueprint" in message for message in messages)

    def test_undeclared_workflow_still_means_history_taking(self):
        """唯一可开始的 workflow 就是 history_taking：省略声明时蓝图仍然生效，不该报错。"""
        report = validate_case(_payload(workflow=None))
        assert report.errors == []
        assert not [i for i in report.warnings if "blueprint" in i.field]

    def test_declared_history_taking_passes(self):
        report = validate_case(_payload(workflow="history_taking"))
        assert report.errors == []
