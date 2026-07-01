import type { ComponentType } from "react"
import type { SceneCardProps } from "./scene-types"

/** A scene card = a protocolised frontend component. */
export interface SceneCard {
  id: string
  component: ComponentType<SceneCardProps>
  featureFlag?: string
  priority: number
}

export type { SceneCardProps }
