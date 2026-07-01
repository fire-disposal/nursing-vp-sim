/**
 * Auto-discover GLB model files on the server.
 *
 * Fetches a file listing from the Vite dev-server middleware at
 * GET /api/models.  New .glb files appear immediately after a
 * refresh (no page reload needed).
 */

export interface DiscoveredModel {
  filename: string
  url: string
  rel: string
}

let _cached: DiscoveredModel[] | null = null

/** Fetch all GLB files from the server's models directory. */
export async function discoverModels(): Promise<DiscoveredModel[]> {
  if (_cached) return _cached
  try {
    const res = await fetch("/api/models")
    if (!res.ok) return []
    const paths: string[] = await res.json()
    _cached = paths.map((rel) => {
      const parts = rel.split("/")
      return {
        filename: parts[parts.length - 1],
        url: `/models/${rel}`,
        rel,
      }
    })
    return _cached
  } catch {
    return []
  }
}

/** Clear cache so next discoverModels() re-fetches. */
export function clearModelCache(): void {
  _cached = null
}
