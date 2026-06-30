import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { error: Error | null }

/** Catches WebGL / R3F render crashes so the shell stays alive */
export class R3FErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[R3FErrorBoundary]", error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100%", background: "#1a1a2a", color: "#e0e0e0", fontFamily: "system-ui", padding: 40, gap: 12,
        }}>
          <div style={{ fontSize: 32, opacity: 0.5 }}>⚠️</div>
          <div style={{ fontWeight: 600 }}>3D 渲染出错</div>
          <pre style={{ color: "#888", fontSize: 12, maxWidth: 500, textAlign: "center", whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
          </pre>
          <button onClick={() => this.setState({ error: null })}
            style={{ padding: "6px 20px", background: "#4fc3f7", border: "none", borderRadius: 6, color: "#111", cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
