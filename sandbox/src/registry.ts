import { lazy, type ComponentType } from "react"
import type { SceneProps } from "./scene-types"
import type { QuickAction } from "./components/SceneDebugger"

export interface SizePref {
  /** Minimum window width the scene needs. */
  minW?: number
  /** Minimum window height. */
  minH?: number
  /** Default opening width (if unset, computed from content). */
  w?: number
  /** Default opening height (if unset, computed from content). */
  h?: number
}

export interface SandboxScene {
  id: string
  name: string
  description: string
  component: ComponentType<SceneProps>
  size?: SizePref
  quickActions?: QuickAction[]
}

function def(id: string, name: string, desc: string, loader: () => Promise<{ default: ComponentType<SceneProps> }>, size?: SizePref, quickActions?: QuickAction[]): SandboxScene {
  return { id, name, description: desc, component: lazy(loader) as ComponentType<SceneProps>, quickActions }
}

export const SANDBOX_SCENES: SandboxScene[] = [
  def("demo-2d", "2D 点触交互", "场景状态编辑器", () => import("./scenes/Demo2D"), { minW: 400, minH: 300, w: 480, h: 400 }),
  def("demo-3d", "3D 诊室 (R3F)", "低面数 3D 诊室", () => import("./scenes/Demo3D"), { minW: 500, minH: 320, w: 640, h: 400 }),
  def("demo-exam", "查体场景", "人体图查体交互", () => import("./scenes/ExamScene"), { minW: 360, minH: 400, w: 420, h: 480 }),
  def("card-patient", "卡片: 患者信息", "患者信息场景卡片", () => import("./scenes/CardPatientInfo"), { w: 280, h: 200 }),
  def("card-inquiry", "卡片: 问诊清单", "问诊清单场景卡片", () => import("./scenes/CardInquiry"), { w: 300, h: 260 }),
  def("card-monitor", "卡片: 监护仪", "监护仪场景卡片", () => import("./scenes/MonitorCard"), { w: 340, h: 280 }, [
    { label: "SpO₂ Low 91%", emit: { event: "scene:state", data: { vitals: { hr: 88, spo2: 91, bp_sys: 130, bp_dia: 85 } } } },
    { label: "Tachy 118", emit: { event: "scene:state", data: { vitals: { hr: 118, spo2: 97, bp_sys: 120, bp_dia: 80 } } } },
    { label: "Brady 48", emit: { event: "scene:state", data: { vitals: { hr: 48, spo2: 98, bp_sys: 110, bp_dia: 70 } } } },
    { label: "Hypoxia 84%", emit: { event: "scene:state", data: { vitals: { hr: 98, spo2: 84, bp_sys: 140, bp_dia: 90 } } } },
    { label: "Fever 39.2", emit: { event: "scene:state", data: { vitals: { hr: 102, spo2: 96, bp_sys: 125, bp_dia: 80, temp: 39.2 } } } },
  ]),
  def("card-notes", "卡片: 笔记", "笔记场景卡片", () => import("./scenes/CardNotes"), { w: 280, h: 240 }),
  def("furniture-lab", "家具工坊", "3D 家具预览 / 参数调整 / GLB 校准", () => import("./scenes/FurnitureLab"), { w: 640, h: 480 }),
]
