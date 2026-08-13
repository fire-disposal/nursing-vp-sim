import { Button, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconAlertCircle, IconHome } from "@tabler/icons-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/utils/telemetry";

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
		reportError(error.name || "RenderError", error.message || "React render error", window.location.pathname, {
			source: "ErrorBoundary",
			componentStack: info.componentStack ?? "",
		});
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
				<Stack
					align="center"
					justify="center"
					gap="md"
					style={{ height: "100vh" }}
				>
					<ThemeIcon variant="light" color="red" size={48} radius="md">
						<IconAlertCircle size={28} />
					</ThemeIcon>
					<Title order={2}>页面出错了</Title>
					<Text size="sm" c="dimmed" ta="center" maw={400}>
						{showDeveloperDetails && this.state.error.message
							? this.state.error.message
							: "请刷新页面重试，或联系管理员并提供当前页面路径。"}
					</Text>
					<Stack gap={8}>
						<Button variant="outline" onClick={this.handleReset}>
							重试
						</Button>
						<Button onClick={() => window.location.reload()}>刷新页面</Button>
						<Button variant="subtle" color="gray" onClick={() => (window.location.href = "/home")}>
							<IconHome size={14} style={{ marginRight: 4 }} />
							返回首页
						</Button>
					</Stack>
					{showDeveloperDetails && (
						<>
							<Button variant="transparent" size="xs" onClick={this.handleToggleDetails}>
								{this.state.showDetails ? "收起错误详情" : "查看错误详情"}
							</Button>
							{this.state.showDetails && (
								<Paper
									withBorder
									p="md"
									radius="md"
									component="pre"
									style={{ maxHeight: 256, maxWidth: 600, overflow: "auto", textAlign: "left" }}
								>
									<Text size="xs" c="dimmed" component="code">
										{this.state.error.message}
										{"\n\n"}
										{this.state.error.stack}
										{this.state.errorInfo && (
											<>
												{"\n\n--- Component Stack ---\n"}
												{this.state.errorInfo.componentStack}
											</>
										)}
									</Text>
								</Paper>
							)}
						</>
					)}
				</Stack>
			);
		}

		return this.props.children;
	}
}
