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
  def("demo-2d", "2D 点触交互", "类过家家 — 场景状态编辑器", () => import("./scenes/Demo2D")),
  def("demo-3d", "3D 诊室 (R3F)", "低面数 3D 诊室 — 可选的视觉渲染器", () => import("./scenes/Demo3D")),
]
