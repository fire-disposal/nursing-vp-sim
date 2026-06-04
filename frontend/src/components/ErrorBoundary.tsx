import { CircleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, showDetails: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] caught:", error);
    console.error("[ErrorBoundary] componentStack:", info.componentStack);
    this.setState({ errorInfo: info });
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null, showDetails: false });
  };

  handleToggleDetails = () => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 font-sans text-gray-700">
          <CircleAlert className="size-12 text-destructive" />
          <h2 className="text-lg font-semibold">页面出错了</h2>
          <p className="max-w-[400px] text-center text-gray-500">{this.state.error.message || "发生未知错误"}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              重试
            </Button>
            <Button onClick={() => window.location.reload()}>刷新页面</Button>
          </div>
          <button type="button" onClick={this.handleToggleDetails} className="cursor-pointer text-sm text-gray-400 underline hover:text-gray-600">
            {this.state.showDetails ? "收起错误详情" : "查看错误详情"}
          </button>
          {this.state.showDetails && (
            <pre className="max-h-64 max-w-[600px] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-left text-xs text-gray-600">
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
              {this.state.errorInfo && (
                <>
                  {"\n\n--- Component Stack ---\n"}
                  {this.state.errorInfo.componentStack}
                </>
              )}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
