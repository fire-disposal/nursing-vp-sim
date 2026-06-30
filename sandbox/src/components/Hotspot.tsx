import { useCallback, useState } from "react"

interface HotspotDef {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  color: string
}

export interface HotspotProps {
  def: HotspotDef
  highlight?: boolean
  onInteract?: (id: string) => void
}

/** 2D clickable area with hover/active states — the core building block for point-and-click scenes */
export function Hotspot({ def, highlight, onInteract }: HotspotProps) {
  const [over, setOver] = useState(false)

  const bg = highlight ? `${def.color}cc` : over ? `${def.color}88` : `${def.color}44`
  const bdr = highlight ? "2px solid #fff" : over ? "1px solid #888" : "1px solid transparent"

  return (
    <div
      onClick={() => onInteract?.(def.id)}
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => setOver(false)}
      style={{
        position: "absolute",
        left: `${def.x}%`, top: `${def.y}%`,
        width: `${def.w}%`, height: `${def.h}%`,
        background: bg,
        border: bdr,
        borderRadius: 8,
        cursor: "pointer",
        transition: "all 0.2s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: highlight ? "#fff" : "#888",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "system-ui",
      }}
    >
      {highlight ? "✓" : def.label}
    </div>
  )
}

export type { HotspotDef }
