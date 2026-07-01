import { lazy, type ComponentType } from "react"
import type { SceneProps } from "./scene-types"

export interface SandboxScene {
  id: string
  name: string
  description: string
  component: ComponentType<SceneProps>
}

function def(id: string, name: string, desc: string, loader: () => Promise<{ default: ComponentType<SceneProps> }>): SandboxScene {
  return { id, name, description: desc, component: lazy(loader) as ComponentType<SceneProps> }
}

export const SANDBOX_SCENES: SandboxScene[] = [
  def("demo-2d", "2D 点触交互", "场景状态编辑器", () => import("./scenes/Demo2D")),
  def("demo-3d", "3D 诊室 (R3F)", "低面数 3D 诊室", () => import("./scenes/Demo3D")),
  def("demo-exam", "查体场景", "人体图查体交互", () => import("./scenes/ExamScene")),
  def("card-patient", "卡片: 患者信息", "患者信息场景卡片 (独立调试)", () => import("./scenes/CardPatientInfo")),
  def("card-inquiry", "卡片: 问诊清单", "问诊清单场景卡片 (独立调试)", () => import("./scenes/CardInquiry")),
  def("card-monitor", "卡片: 监护仪", "监护仪场景卡片 (独立调试)", () => import("./scenes/MonitorCard")),
  def("card-notes", "卡片: 笔记", "笔记场景卡片 (独立调试)", () => import("./scenes/CardNotes")),
]
