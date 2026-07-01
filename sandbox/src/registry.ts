/**
 * Auto‑discovered scene registry.
 *
 * Any file under scenes/ that exports `sceneMeta` is automatically
 * registered — no manual entry needed.
 */
import type { ComponentType } from "react"
import type { SceneMeta, SceneProps } from "./scene-types"

export type { SizePref, SceneMeta, QuickAction } from "./scene-types"

export interface SandboxScene extends SceneMeta {
  component: ComponentType<SceneProps>
}

interface SceneModule {
  default: ComponentType<SceneProps>
  sceneMeta?: SceneMeta
}

const modules = import.meta.glob<SceneModule>("./scenes/*.tsx", { eager: true })

export const SANDBOX_SCENES: SandboxScene[] = Object.entries(modules)
  .filter(([, mod]) => mod.sceneMeta)
  .map(([, mod]) => ({
    ...mod.sceneMeta!,
    component: mod.default,
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

/** Built‑in icon lookup (fallback when sceneMeta.icon is absent). */
export function sceneIcon(s: SandboxScene): string {
  return s.icon || "◻"
}
