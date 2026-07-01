import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import fs from "fs"
import path from "path"

// ── Models discovery API ────────────────────────────────────
// Serves GET /api/models → JSON array of .glb/.gltf file paths
// so the sandbox can discover new models at runtime without page reload.

const MODELS_DIR = path.resolve(__dirname, "public/models")

function modelsApiPlugin(): Plugin {
  return {
    name: "models-api",
    configureServer(server) {
      server.middlewares.use("/api/models", (_req, res) => {
        const files: string[] = []
        if (fs.existsSync(MODELS_DIR)) {
          try {
            function walk(dir: string) {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (entry.isFile() && /\.(glb|gltf)$/i.test(entry.name))
                  files.push(path.relative(MODELS_DIR, full).replace(/\\/g, "/"))
              }
            }
            walk(MODELS_DIR)
          } catch {
            // readdir can fail on locked files (Windows EBUSY) — return partial listing
          }
        }
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify(files))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), modelsApiPlugin()],
  server: {
    port: 4000,
    open: true,
    watch: {
      ignored: ["**/*.glb", "**/*.gltf"],
    },
  },
})
