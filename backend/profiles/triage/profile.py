from __future__ import annotations

from contexts.patient.note_source import OperationNoteSource
from profiles.registry import PhaseConfig, PromptCollection, TrainingProfile

_TRIAGE_SYSTEM_PROMPT = """你是一位正在急诊室就诊的患者。你感觉不舒服，需要帮助。

## 身份
姓名：{#patient_info#}

## 场景
{#scenario#}

## 主诉
{#chief_complaint#}

## 必须遵守
1. **按患者身份回应** — 回答简短，描述症状感受
2. **不暴露AI身份**
3. **不自己做分诊判断**
4. **不知道自己的生命体征数值**
"""

_TRIAGE_DYNAMIC_PROMPT = """## 病情信息

**主诉**: {#chief_complaint#}
**到达方式**: {#arrival_mode#}
**意识状态**: {#consciousness#}
**生命体征**: 心率{#hr#}，血压{#bp#}，呼吸{#rr#}，血氧{#spo2#}%，体温{#temp#}°C
**警示信号**: {#red_flags#}
"""

_TRIAGE_SCORING_SYSTEM = """你是一位分诊训练评估专家。请根据学生的分诊操作进行评分。

## 评分维度

### 1. MEWS 评分准确性（0-5分）
评估学生计算的 MEWS（改良早期预警评分）是否与标准计算一致。

### 2. 分诊级别正确性（0-5分）
评估学生选择的分诊级别是否符合患者病情。

### 3. 目标科室选择（0-5分）
评估学生推荐的目标科室是否恰当。

### 4. 分诊效率（0-5分）
评估学生在合理时间内完成了分诊流程。

请输出严格 JSON 格式：
{
  "total_score": 数字(满分20),
  "detail_scores": {
    "MEWS评分": {"score": 数字, "evidence": "..."},
    "分诊级别": {"score": 数字, "evidence": "..."},
    "科室选择": {"score": 数字, "evidence": "..."},
    "分诊效率": {"score": 数字, "evidence": "..."}
  },
  "strengths": [...],
  "weaknesses": [...],
  "missed_content": [...],
  "suggestions": "..."
}
"""

_TRIAGE_SCORING_USER = """请根据以下分诊记录进行评分：

## 患者信息
主诉：{#chief_complaint#}
到达方式：{#arrival_mode#}
生命体征：心率{#hr#}，血压{#bp#}，呼吸{#rr#}，血氧{#spo2#}%，体温{#temp#}°C
意识状态：{#consciousness#}
正确MEWS评分：{#mews_score#}

## 学生操作
{#student_actions#}
"""

PROFILE = TrainingProfile(
    name="triage",
    initial_phase="triage_assessment",
    phases=[
        PhaseConfig(
            id="triage_assessment",
            name="分诊评估",
            order=1,
            operations=["chat"],
            prompt_profile="triage_chat",
            scoring_dimensions=["MEWS评分", "分诊级别", "科室选择", "分诊效率"],
            transition={"auto": True, "auto_after_messages": 9999},
        ),
    ],
    note_sources=[OperationNoteSource],
    prompts=PromptCollection(
        system=_TRIAGE_SYSTEM_PROMPT,
        dynamic=_TRIAGE_DYNAMIC_PROMPT,
        scoring=_TRIAGE_SCORING_SYSTEM,
        scoring_user=_TRIAGE_SCORING_USER,
    ),
    rubric={
        "name": "triage_v1",
        "version": "1.0",
        "raw_max": 20,
        "raw_scale": 5,
        "total_max": 100,
        "dimensions": [
            {
                "name": "MEWS评分",
                "items": [
                    {
                        "id": "mews_accuracy",
                        "label": "MEWS评分准确性",
                        "max": 5,
                        "anchors": ["完全错误", "部分正确", "基本正确", "完全正确", "精确计算", "完美"],
                    },
                ],
            },
            {
                "name": "分诊级别",
                "items": [
                    {"id": "category", "label": "分诊级别正确性", "max": 5},
                ],
            },
            {
                "name": "科室选择",
                "items": [
                    {"id": "department", "label": "目标科室恰当性", "max": 5},
                ],
            },
            {
                "name": "分诊效率",
                "items": [
                    {"id": "speed", "label": "分诊完成效率", "max": 5},
                ],
            },
        ],
    },
    max_rounds=6,
    has_emotion=False,
    has_initiative=False,
)
