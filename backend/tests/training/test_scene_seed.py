"""初始 scene 播种（``router/session.py:_seed_scene``）。

这里是 ``runtime_state.scene`` 的唯一播种点。它曾逐键手挑（environment/patient/vitals
各自取键重建），于是病例里**新声明**的场景字段会被静默丢弃 —— 实测 ``case1.json`` 声明的
``scene.patient.breathing`` 与 ``scene.phase`` 都到不了学生眼前（``scene.patient.breathing``
在会话详情里是 null）。播种改为整块过 ``SceneState`` 后，模型新增字段自动随行。

契约：只**补默认 + 校验**，不裁剪 —— 未测量体征的裁剪是读侧 ``_public_scene`` 的事。
"""

import json
from pathlib import Path

import pytest

from modules.training.router.session import _seed_scene

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cases"


def test_seed_keeps_declared_patient_breathing():
    """``breathing`` 是可见的呼吸状态（在场感）；逐键手挑时代它会被丢掉。"""
    scene = _seed_scene({"scene": {"patient": {"breathing": "labored"}}})
    assert scene["patient"]["breathing"] == "labored"


def test_seed_does_not_invent_undeclared_vitals():
    """未声明的体征不落成 None 键：没查过就没有这个事实。"""
    scene = _seed_scene({"scene": {"patient": {"visible_symptoms": ["喘息"]}, "vitals": {"hr": 94}}})
    assert scene["vitals"] == {"hr": 94}


def test_seed_fills_historical_defaults():
    """病例没声明时补的默认值保持既有播种语义（不随模型默认值漂移）。"""
    scene = _seed_scene({})
    assert scene["environment"] == {"type": "ward", "time_of_day": "day", "equipment": [], "noise_level": "quiet"}
    assert scene["patient"] == {
        "position": "semi-recumbent",
        "consciousness": "alert",
        "visible_symptoms": [],
        "expression": "neutral",
    }


def test_seed_falls_back_to_patient_info_for_symptoms_and_expression():
    """病例未在 scene.patient 里声明这两项时，回落到 ``patient_info`` 的同名声明。"""
    scene = _seed_scene({"patient_info": {"visible_symptoms": ["喘息"], "expression": "紧张"}})
    assert scene["patient"]["visible_symptoms"] == ["喘息"]
    assert scene["patient"]["expression"] == "紧张"


def test_seed_prefers_declared_empty_symptoms_over_patient_info():
    """显式声明"没有可见症状"是作者的选择，不能被 patient_info 的列表盖掉。"""
    scene = _seed_scene(
        {"patient_info": {"visible_symptoms": ["喘息"]}, "scene": {"patient": {"visible_symptoms": []}}}
    )
    assert scene["patient"]["visible_symptoms"] == []


def test_seed_keeps_every_field_declared_by_a_real_case():
    """真实病例（case1）声明的 scene 字段逐字段落到播种结果里。"""
    case = json.loads((CASES_DIR / "case1.json").read_text(encoding="utf-8"))
    declared = case.get("scene") or {}
    if not declared:
        pytest.skip("case1 未声明 scene")
    scene = _seed_scene(case)
    for section in ("environment", "patient", "vitals"):
        for key, value in (declared.get(section) or {}).items():
            assert scene[section][key] == value, f"{section}.{key} 被播种丢掉了"
    if "phase" in declared:
        assert scene["phase"] == declared["phase"]
