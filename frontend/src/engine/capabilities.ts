/** Mirrors backend/core/capabilities.py — source of truth for feature flags. */
export interface CapabilityDef {
  key: string;
  label: string;
  description: string;
  defaultOn: boolean;
}

export const ALL_CAPABILITIES: Record<string, CapabilityDef> = {
  physical_exam: {
    key: "physical_exam",
    label: "护理查体",
    description: "可执行生命体征测量、体格检查等操作",
    defaultOn: true,
  },
  exam_scene: {
    key: "exam_scene",
    label: "人体查体场景",
    description: "可视化人体图交互查体",
    defaultOn: false,
  },
  emotion: {
    key: "emotion",
    label: "患者情绪状态",
    description: "患者情绪随对话动态变化",
    defaultOn: false,
  },
  patient_initiative: {
    key: "patient_initiative",
    label: "患者主动追问",
    description: "患者会根据等待时长主动发言",
    defaultOn: false,
  },
};

/** Which capabilities are available for each training type. */
export const TRAINING_CAPABILITIES: Record<string, string[]> = {
  history_taking: ["physical_exam", "emotion", "patient_initiative", "exam_scene"],
  triage: ["exam_scene"],
};

/** Resolve final feature set from defaults + overrides. */
export function resolveFeatures(
  profileCaps: string[],
  overrides: Record<string, boolean>,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of profileCaps) {
    const def = ALL_CAPABILITIES[key];
    result[key] = overrides[key] ?? (def ? def.defaultOn : false);
  }
  return result;
}
