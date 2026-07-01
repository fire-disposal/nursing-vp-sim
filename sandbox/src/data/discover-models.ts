/**
 * Auto-discover GLB model files served from /models/.
 *
 * Uses Vite's import.meta.glob at build time — files added to
 * assets/models/ appear automatically after dev server restart.
 */

// Vite resolves these to their served public URLs
const modelModules = import.meta.glob("/models/**/*.glb", {
  eager: true,
  query: "?url",
  import: "default",
})

export interface DiscoveredModel {
  /** Just the filename, e.g. "chair.glb" */
  filename: string
  /** Served URL, e.g. "/models/furniture/chair.glb" */
  url: string
  /** Relative path under /models/, e.g. "furniture/chair.glb" */
  rel: string
}

/** Return all GLB files found under /models/. */
export function discoverModels(): DiscoveredModel[] {
  return Object.entries(modelModules).map(([fp, url]) => {
    const parts = fp.replace(/^\/models\//, "").split("/")
    return {
      filename: parts[parts.length - 1],
      url: url as string,
      rel: fp.replace(/^\//, ""),
    }
  })
}
