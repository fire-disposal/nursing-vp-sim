import { lazy } from "react";
import type { ComponentType } from "react";
import type { SceneCard, SceneCardProps } from "@/engine/scene-card";
import PatientInfoCard from "./PatientInfoCard";
import InquiryCard from "./InquiryCard";
import NotesCard from "./NotesCard";

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
  { id: "patient-info",  component: PatientInfoCard,                          priority: 0 },
  { id: "inquiry",       component: InquiryCard,                              priority: 1 },
  def("body-exam",   () => import("@/components/training/body-exam/ExamBodyScene"), 2, "physical_exam"),
  { id: "notes",         component: NotesCard,                                priority: 3 },
];

const TRIAGE: CardDef[] = [
  { id: "patient-info",  component: PatientInfoCard,                          priority: 0 },
  def("mews",        () => import("@/components/training/panels/triage/MewsPanel"), 1, "exam_scene"),
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
    .map(({ id, component, priority }) => ({ id, component, priority } as SceneCard));
}
