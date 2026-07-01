import { lazy, type ComponentType } from "react"
import type { SceneCardProps, SceneProps } from "./scene-types"
import PatientInfoCard from "./scenes/PatientInfoCard"
import InquiryCard from "./scenes/InquiryCard"
import NotesCard from "./scenes/NotesCard"
import MonitorCard from "./scenes/MonitorCard"

// ── Full scenes (standalone pages) ──
export interface SandboxScene {
  id: string
  name: string
  description: string
  component: ComponentType<SceneProps>
  /** Which scene cards this scene previews. */
  cards?: SceneCardDef[]
}

export interface SceneCardDef {
  id: string
  name: string
  component: ComponentType<SceneCardProps>
  featureFlag?: string
}

function defScene(id: string, name: string, desc: string, loader: () => Promise<{ default: ComponentType<SceneProps> }>, cards?: SceneCardDef[]): SandboxScene {
  return { id, name, description: desc, component: lazy(loader) as ComponentType<SceneProps>, cards }
}

export const SANDBOX_SCENES: SandboxScene[] = [
  defScene("demo-2d", "2D 点触交互", "类过家家 — 场景状态编辑器", () => import("./scenes/Demo2D")),
  defScene("demo-3d", "3D 诊室 (R3F)", "低面数 3D 诊室", () => import("./scenes/Demo3D")),
  defScene("demo-exam", "查体场景", "人体图查体交互", () => import("./scenes/ExamScene")),
  defScene("sandbox-cards", "场景卡片组", "PatientInfo + Inquiry + Monitor + Notes 场景卡片", () => import("./scenes/SandboxCards"), [
    { id: "patient-info", name: "患者信息", component: PatientInfoCard },
    { id: "inquiry", name: "问诊清单", component: InquiryCard },
    { id: "monitor", name: "监护仪", component: MonitorCard },
    { id: "notes", name: "笔记", component: NotesCard },
  ]),
]
