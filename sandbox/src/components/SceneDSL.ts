/**
 * Scene DSL — portable scene description format.
 *
 * Both SceneEditor (authoring) and Demo3D (rendering) consume this,
 * enabling a "design → preview → deploy" pipeline for 3D rooms.
 */

export interface SceneDSLItem {
  id: string       // furniture catalog id (matches FURNI entries)
  gx: number
  gz: number
  rotation: number
  ty: number
}

export interface SceneDSL {
  version: number
  grid: string[]           // each string is a row of "1" (floor) / "0" (empty)
  items: SceneDSLItem[]
  room: {
    w: number              // cells along X (default 14)
    d: number              // cells along Z (default 12)
    unit: number           // metres per cell (default 1.0)
  }
}

/** Parse grid strings into a boolean[][] lookup. */
export function parseGrid(grid: string[]): boolean[][] {
  return grid.map(row => row.split("").map(c => c === "1"))
}

/** Default empty scene (14×12 all‑empty grid). */
export function emptyScene(): SceneDSL {
  return {
    version: 1,
    grid: Array.from({ length: 12 }, () => "0".repeat(14)),
    items: [],
    room: { w: 14, d: 12, unit: 1.0 },
  }
}
