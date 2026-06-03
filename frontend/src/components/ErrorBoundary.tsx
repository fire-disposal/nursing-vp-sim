import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] caught:", error);
    console.error("[ErrorBoundary] componentStack:", info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            gap: 16,
            fontFamily: "system-ui, sans-serif",
            color: "#374151",
          }}
        >
          <h2 style={{ margin: 0 }}>页面出错了</h2>
          <p style={{ color: "#6b7280", margin: 0, maxWidth: 400, textAlign: "center" }}>{this.state.error.message || "发生未知错误"}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: "8px 24px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                background: "#fff",
                color: "#374151",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 24px",
                border: "none",
                borderRadius: 8,
                background: "#2563eb",
                color: "#fff",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
