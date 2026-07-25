// AUTO-GENERATED from backend/core/capabilities.py — DO NOT EDIT.
// 由 `pnpm run cap:generate` 生成；修改能力请改后端并重新生成。

export type CapabilityTier = "builtin" | "toggleable";

export interface CapabilityDef {
  key: string;
  label: string;
  description: string;
  tier: CapabilityTier;
  trainingTypes: string[] | null;
  requires: string[];
}

export const ALL_CAPABILITIES: Record<string, CapabilityDef> = {
  "emotion": {
    "key": "emotion",
    "label": "患者情绪状态机",
    "description": "6态情绪模型，根据学生用语动态变化。",
    "tier": "builtin",
    "trainingTypes": null,
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
    "requires": [
      "emotion"
    ]
  },
  "physical_exam": {
    "key": "physical_exam",
    "label": "护理查体",
    "description": "允许学生触发护理操作（测血压/体温/听诊等）。仅当病例含 exam_anchors 数据时可用。",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "requires": []
  },
  "nursing_record": {
    "key": "nursing_record",
    "label": "护理评估记录",
    "description": "结构化护理评估表单填写（ADPIE）。仅当病例含 nursing_record 数据时可用。",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "requires": []
  },
  "quiz": {
    "key": "quiz",
    "label": "引导题目",
    "description": "训练中穿插病例相关的引导性选择题。不参与评分。",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking",
      "triage"
    ],
    "requires": []
  },
  "mews": {
    "key": "mews",
    "label": "MEWS 评分",
    "description": "分诊场景下的早期预警评分计算工具。",
    "tier": "toggleable",
    "trainingTypes": [
      "triage"
    ],
    "requires": []
  }
};

/** 每训练类型可配置（toggleable）能力键；builtin 隐式恒开，不在此列。 */
export const TRAINING_CAPABILITIES: Record<string, string[]> = {
  "history_taking": [
    "patient_initiative",
    "physical_exam",
    "nursing_record",
    "quiz"
  ],
  "triage": [
    "quiz",
    "mews"
  ]
};
