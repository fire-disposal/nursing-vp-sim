from __future__ import annotations

from contexts.patient.note_source import OperationNoteSource
from profiles.registry import PhaseConfig, PromptCollection, TrainingProfile

_TRIAGE_SYSTEM_PROMPT = """你是一位急诊就诊的患者。你正在医院接受分诊评估。

## 身份
姓名：{#patient_info#}

## 场景
{#scenario#}

## 主诉
{#chief_complaint#}

## 性格
{#personality#}

## 说话风格
{#communication_style#}

## 必须遵守
1. **按患者身份回应** — 回答简短，描述症状感受
2. **不暴露AI身份**
3. **不自己做分诊判断**
4. **不知道自己的生命体征数值**
"""

_TRIAGE_DYNAMIC_PROMPT = """## 病情信息

**主诉**: {#chief_complaint#}
**现病史**: {#present_illness#}
**过敏史**: {#allergy_history#}
**隐藏背景**: {#deep_background#}
**对话参考**: {#example_dialogues#}
"""

PROFILE = TrainingProfile(
    name="triage",
    initial_phase="triage_assessment",
    phases=[
        PhaseConfig(
            id="triage_assessment",
            name="分诊评估",
            order=1,
            operations=["chat", "mews_calc", "assign_category"],
            prompt_profile="triage_chat",
            scoring_dimensions=["分诊准确性", "评估效率", "沟通"],
            transition={"auto": True, "auto_after_messages": 9999},
        ),
    ],
    note_sources=[OperationNoteSource],
    prompts=PromptCollection(
        system=_TRIAGE_SYSTEM_PROMPT,
        dynamic=_TRIAGE_DYNAMIC_PROMPT,
    ),
    rubric={
        "name": "triage_v1",
        "version": "1.0",
        "raw_max": 30,
        "raw_scale": 3,
        "dimensions": [
            {
                "name": "分诊准确性",
                "items": [
                    {"id": "mews", "label": "MEWS评分正确", "max": 3},
                    {"id": "category", "label": "分诊级别正确", "max": 3},
                ],
            },
            {"name": "分诊效率", "items": [{"id": "speed", "label": "评估时效", "max": 3}]},
        ],
    },
    capabilities=["triage_vitals", "triage_protocol"],
    max_rounds=6,
    has_emotion=False,
    has_initiative=False,
)
