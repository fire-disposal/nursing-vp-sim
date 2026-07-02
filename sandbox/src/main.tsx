import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "bootstrap/dist/css/bootstrap.min.css"
import { SandboxShell } from "./SandboxShell"

const params = new URLSearchParams(window.location.search)
const initialScene = params.get("scene") || undefined

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SandboxShell initialScene={initialScene} />
  </StrictMode>,
)
