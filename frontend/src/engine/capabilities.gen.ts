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
  "nursing_record": {
    "key": "nursing_record",
    "label": "护理评估记录",
    "description": "结构化护理评估表单填写，可开启评分维度。",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "defaultOn": false,
    "requires": []
  }
};

/** 每训练类型可配置（toggleable）能力键；builtin 隐式恒开，不在此列。 */
export const TRAINING_CAPABILITIES: Record<string, string[]> = {
  "history_taking": [
    "patient_initiative",
    "physical_exam",
    "nursing_record"
  ],
  "triage": [
    "physical_exam"
  ]
};
