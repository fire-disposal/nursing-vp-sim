import type { ComponentType } from "react";
import { lazy } from "react";
import type { SceneCard, SceneCardProps } from "@/engine/scene-card";
import InquiryCard from "./InquiryCard";
import NursingRecordCard from "./NursingRecordCard";
import PatientInfoCard from "./PatientInfoCard";
import PhysicalAssessmentCard from "./PhysicalAssessmentCard";

interface CardDef {
  id: string;
  component: ComponentType<SceneCardProps>;
  featureFlag?: string;
  priority: number;
}

function def(id: string, loader: () => Promise<{ default: ComponentType<SceneCardProps> }>, priority: number, featureFlag?: string): CardDef {
  return { id, component: lazy(loader) as ComponentType<SceneCardProps>, priority, featureFlag };
}

const HISTORY_TAKING: CardDef[] = [
  { id: "patient-info",     component: PatientInfoCard,                            priority: 0 },
  { id: "inquiry",          component: InquiryCard,                                priority: 1 },
  { id: "physical-exam",    component: PhysicalAssessmentCard,                     priority: 2, featureFlag: "physical_exam" },
  { id: "nursing-record",   component: NursingRecordCard,                          priority: 3, featureFlag: "nursing_record" },
];

const TRIAGE: CardDef[] = [
  { id: "patient-info",     component: PatientInfoCard,                            priority: 0 },
  { id: "physical-exam",    component: PhysicalAssessmentCard,                     priority: 1, featureFlag: "physical_exam" },
  def("mews",           () => import("@/components/training/panels/MewsPanel"), 2, "physical_exam"),
];

const REGISTRY: Record<string, CardDef[]> = {
  history_taking: HISTORY_TAKING,
  triage: TRIAGE,
};

export function getSceneCards(trainingType: string, enabledFeatures: Record<string, boolean>): SceneCard[] {
  const defs = REGISTRY[trainingType] ?? REGISTRY.history_taking;
  return defs
    .filter((c) => !c.featureFlag || enabledFeatures[c.featureFlag])
    .sort((a, b) => a.priority - b.priority)
    .map(({ id, component, priority, featureFlag }) => ({ id, component, priority, featureFlag } as SceneCard));
}
