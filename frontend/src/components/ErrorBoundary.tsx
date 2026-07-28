import { CircleAlert, Home } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
			const showDeveloperDetails = import.meta.env.DEV;

			return (
				<div className="flex h-screen flex-col items-center justify-center gap-4 font-sans text-foreground">
					<CircleAlert className="size-12 text-destructive" />
					<h2 className="text-lg font-semibold">页面出错了</h2>
					<p className="max-w-[400px] text-center text-muted-foreground">
						{showDeveloperDetails && this.state.error.message ? this.state.error.message : "请刷新页面重试，或联系管理员并提供当前页面路径。"}
					</p>
					<div className="flex gap-2">
						<Button variant="outline" onClick={this.handleReset}>
							重试
						</Button>
						<Button onClick={() => window.location.reload()}>刷新页面</Button>
						<Button variant="ghost" onClick={() => (window.location.href = "/home")}>
							<Home className="mr-1 size-4" />
							返回首页
						</Button>
					</div>
					{showDeveloperDetails && (
						<>
							<button
								type="button"
								onClick={this.handleToggleDetails}
								className="cursor-pointer text-sm text-muted-foreground underline hover:text-foreground"
							>
								{this.state.showDetails ? "收起错误详情" : "查看错误详情"}
							</button>
							{this.state.showDetails && (
								<pre className="max-h-64 max-w-[600px] overflow-auto rounded-lg border border-border bg-muted p-4 text-left text-xs text-muted-foreground">
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
						</>
					)}
				</div>
			);
		}

		return this.props.children;
	}
}
