/**
 * Furniture Registry — master manifest for all GLB furniture assets.
 *
 * Fetched at runtime from `/models/furniture-registry.json` (shared
 * between sandbox & production via directory junction).  Filename is
 * the stable key; hash is optional integrity check.
 *
 * Two tiers co-exist in the UI:
 *   1. Registry entries (JSON) — GLB-backed, calibratable.
 *   2. Primitive entries (furniture-catalog.tsx) — built-in, no GLB.
 *   Registry overrides primitives when id matches.
 */

// ── Types ──

export interface CalibrationParams {
  scale: number
  tx: number
  ty: number
  tz: number
  rot: number
}

export interface FurnitureEntry {
  id: string
  name: string
  category: string
  tags: string[]
  enabled: boolean
  glb?: string
  hash?: string | null
  calibration: CalibrationParams
}

// ── Runtime cache ──

let _cache: Record<string, FurnitureEntry> | null = null

async function load(): Promise<Record<string, FurnitureEntry>> {
  if (_cache) return _cache
  try {
    const res = await fetch("/models/furniture-registry.json")
    if (!res.ok) { _cache = {}; return _cache }
    const data: Record<string, FurnitureEntry> = await res.json()
    _cache = data
    return _cache
  } catch {
    _cache = {}
    return _cache
  }
}

/** Ensure the registry is loaded (call once at app init if desired). */
export function preload(): void { load() }

// ── Lookup ──

export async function getEntry(id: string): Promise<FurnitureEntry | null> {
  const table = await load()
  return table[id] ?? null
}

export async function getEnabledEntries(): Promise<FurnitureEntry[]> {
  const table = await load()
  return Object.values(table).filter((e) => e.enabled)
}

export async function getAllEntries(): Promise<FurnitureEntry[]> {
  const table = await load()
  return Object.values(table)
}

// ── Mutations (return JSON for download, no server write) ──

export function buildEntry(
  filename: string,
  name: string,
  category: string,
  tags: string[],
  hash: string | null,
  calibration: CalibrationParams,
): FurnitureEntry {
  return {
    id: filename,
    name,
    category,
    tags,
    enabled: true,
    glb: `/models/${filename}`,
    hash,
    calibration: {
      scale: Math.round(calibration.scale * 100) / 100,
      tx: Math.round(calibration.tx * 100) / 100,
      ty: Math.round(calibration.ty * 100) / 100,
      tz: Math.round(calibration.tz * 100) / 100,
      rot: calibration.rot,
    },
  }
}

/** Merge an entry into the existing table and return full JSON for download. */
export async function mergeEntry(entry: FurnitureEntry): Promise<string> {
  const table = await load()
  table[entry.id] = entry
  _cache = table
  return JSON.stringify(table, null, 2) + "\n"
}

/** Toggle enabled and return full JSON. */
export async function toggleEnabled(id: string): Promise<string> {
  const table = await load()
  const entry = table[id]
  if (entry) entry.enabled = !entry.enabled
  _cache = table
  return JSON.stringify(table, null, 2) + "\n"
}
