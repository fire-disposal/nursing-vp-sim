import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { SandboxShell } from "./components/SandboxShell"

const params = new URLSearchParams(window.location.search)
const initialScene = params.get("scene") || undefined

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SandboxShell initialScene={initialScene} />
  </StrictMode>,
)
