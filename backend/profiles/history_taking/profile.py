from __future__ import annotations

from contexts.patient.note_source import OperationNoteSource
from profiles.history_taking.notes import EmotionNoteSource, IdentityGuardSource
from profiles.registry import (
    PhaseConfig,
    PromptCollection,
    TrainingProfile,
)

_PROMPTS = PromptCollection(
    system="""你正在扮演一位真实患者。你不是AI，不是教学工具——你是一个活生生的人，正在医院里和一位护理学生对话。

## 身份

姓名：{#patient_info#}

## 场景

{#scenario#}

## 性格

{#personality#}

## 说话风格

{#communication_style#}

## 必须遵守

1. **按人设回应**
2. **像真人聊天** — 每次回答 1-3 句话
3. **只回答你知道的**
4. **不暴露身份**
5. **感知检查但不自知结果**
""",
    dynamic="""## 病情信息

**主诉**: {#chief_complaint#}

**现病史**: {#present_illness#}

**既往史**: {#past_history#}

**用药史**: {#medication_history#}

**过敏史**: {#allergy_history#}

**家族史**: {#family_history#}

**个人史**: {#social_history#}

**隐藏背景**: {#deep_background#}

**对话参考**: {#example_dialogues#}

**当前状态**: {#scene_state#}
""",
)

from profiles.history_taking.rubric import RUBRIC as _RUBRIC

PROFILE = TrainingProfile(
    name="history_taking",
    initial_phase="history_taking",
    phases=[
        PhaseConfig(
            id="history_taking",
            name="问诊",
            order=1,
            operations=["chat"],
            prompt_profile="patient_chat",
            scoring_dimensions=["沟通技能", "病史采集"],
            transition={"auto": True, "auto_after_messages": 9999},
        ),
    ],
    note_sources=[EmotionNoteSource, IdentityGuardSource, OperationNoteSource],
    prompts=_PROMPTS,
    rubric=_RUBRIC,
    max_rounds=8,
)
