/**
 * Grid-based room layout system.
 *
 * All scene objects derive positions from grid coordinates so that
 * swapping / authoring furniture is purely data-driven.
 *
 *   gridToWorld({ gx: 0, gz: 0 })  →  room centre
 *   gridToWorld({ gx: 1, gz: 0 })  →  1 unit east
 */

export const GRID = {
  UNIT: 0.5,                // metres per grid cell
  ROOM_W: 14,               // cells along X
  ROOM_D: 12,               // cells along Z
  WALL_H: 3,                // wall height (metres)
  get W() { return this.ROOM_W * this.UNIT },
  get D() { return this.ROOM_D * this.UNIT },
} as const

export interface GridPos { gx: number; gz: number }

/** Convert grid coords → world space (origin at room centre) */
export function gridToWorld({ gx, gz }: GridPos, y = 0): [number, number, number] {
  const wx = (gx - GRID.ROOM_W / 2) * GRID.UNIT + GRID.UNIT / 2
  const wz = (gz - GRID.ROOM_D / 2) * GRID.UNIT + GRID.UNIT / 2
  return [wx, y, wz]
}

/** Range of grid cells — for iteration */
export function gridCells(): { gx: number; gz: number }[] {
  const cells: { gx: number; gz: number }[] = []
  for (let gx = 0; gx < GRID.ROOM_W; gx++)
    for (let gz = 0; gz < GRID.ROOM_D; gz++)
      cells.push({ gx, gz })
  return cells
}

/**
 * Wall definitions using grid coordinates.
 * inward vector points into the room.
 */
export interface WallDef {
  gridPos: GridPos            // world is derived
  axis: "x" | "z"
  side: "min" | "max"         // which side of the room
}

export const ROOM_WALLS: WallDef[] = [
  { gridPos: { gx: 0, gz: 0 },        axis: "x", side: "min" },  // back
  { gridPos: { gx: 0, gz: 0 },        axis: "z", side: "min" },  // left
  { gridPos: { gx: GRID.ROOM_W, gz: 0 }, axis: "z", side: "max" },  // right
]

export function wallToWorld(def: WallDef) {
  const halfW = GRID.W / 2
  const halfD = GRID.D / 2
  const halfH = GRID.WALL_H / 2

  if (def.axis === "x") {
    // Horizontal wall (along X axis)
    const z = def.side === "min" ? -halfD : halfD
    return { position: [0, halfH, z] as [number, number, number], size: [GRID.W, GRID.WALL_H, 0.08] as [number, number, number] }
  } else {
    // Vertical wall (along Z axis)
    const x = def.side === "min" ? -halfW : halfW
    return { position: [x, halfH, 0] as [number, number, number], size: [0.08, GRID.WALL_H, GRID.D] as [number, number, number] }
  }
}
