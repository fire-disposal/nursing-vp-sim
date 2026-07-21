export interface TrainingTypeInfo {
  type: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  case_count?: number;
}

export const TRAINING_TYPE_CONFIGS: Record<string, { color: string; gradient: string }> = {
  history_taking: {
    color: "blue",
    gradient: "from-blue-500/10 to-blue-500/5",
  },
  triage: {
    color: "red",
    gradient: "from-red-500/10 to-red-500/5",
  },
};
