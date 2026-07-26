// AUTO-GENERATED from backend/contexts/training/capabilities.py — DO NOT EDIT.
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
  "quiz": {
    "key": "quiz",
    "label": "随堂测验",
    "description": "训练过程中弹出选择题/判断题，检测学生知识掌握情况",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "requires": []
  },
  "physical_exam": {
    "key": "physical_exam",
    "label": "护理查体",
    "description": "学生可进行虚拟体格检查（测量生命体征）",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "requires": []
  },
  "nursing_record": {
    "key": "nursing_record",
    "label": "护理记录",
    "description": "生成结构化护理记录（ADPIE 格式）",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "requires": []
  },
  "mews": {
    "key": "mews",
    "label": "MEWS 评分",
    "description": "早期预警评分计算工具",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "requires": []
  },
  "nursing_diagnosis": {
    "key": "nursing_diagnosis",
    "label": "护理诊断",
    "description": "NANDA 护理诊断制定与优先级排序",
    "tier": "toggleable",
    "trainingTypes": [
      "history_taking"
    ],
    "requires": []
  }
};

/** 每训练类型可配置（toggleable）能力键；builtin 隐式恒开，不在此列。 */
export const TRAINING_CAPABILITIES: Record<string, string[]> = {
  "history_taking": [
    "quiz",
    "physical_exam",
    "nursing_record",
    "mews",
    "nursing_diagnosis"
  ]
};
