// AUTO-GENERATED from backend/core/capabilities.py — DO NOT EDIT.
// 由 `pnpm run cap:generate` 生成；修改能力请改后端并重新生成。

export type CapabilityTier = "builtin" | "toggleable";

export interface CapabilityDef {
  key: string;
  label: string;
  description: string;
  tier: CapabilityTier;
  trainingTypes: string[] | null;
  defaultOn: boolean;
  requires: string[];
}

export const ALL_CAPABILITIES: Record<string, CapabilityDef> = {
  "emotion": {
    "key": "emotion",
    "label": "患者情绪状态机",
    "description": "5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化。虚拟病人的内置第一性质，全类型恒开。",
    "tier": "builtin",
    "trainingTypes": null,
    "defaultOn": false,
    "requires": []
  },
  "patient_initiative": {
    "key": "patient_initiative",
    "label": "患者主动追问",
    "description": "患者根据性格/情绪/等待时长主动发言。",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "defaultOn": false,
    "requires": [
      "emotion"
    ]
  },
  "physical_exam": {
    "key": "physical_exam",
    "label": "护理查体",
    "description": "允许学生触发护理操作（测血压/体温/听诊等）。",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking",
      "triage"
    ],
    "defaultOn": false,
    "requires": []
  },
  "exam_scene": {
    "key": "exam_scene",
    "label": "人体查体场景",
    "description": "启用可视化人体查体交互（点击人体部位执行检查）。",
    "tier": "toggleable",
    "trainingTypes": [
      "triage"
    ],
    "defaultOn": false,
    "requires": []
  },
  "questionnaire": {
    "key": "questionnaire",
    "label": "问卷评估",
    "description": "训练结束后向学生推送问卷调查。",
    "tier": "toggleable",
    "trainingTypes": null,
    "defaultOn": false,
    "requires": []
  }
};

/** 每训练类型可配置（toggleable）能力键；builtin 隐式恒开，不在此列。 */
export const TRAINING_CAPABILITIES: Record<string, string[]> = {
  "history_taking": [
    "patient_initiative",
    "physical_exam",
    "questionnaire"
  ],
  "triage": [
    "physical_exam",
    "exam_scene",
    "questionnaire"
  ]
};
