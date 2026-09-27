import { Button, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconAlertCircle, IconHome } from "@tabler/icons-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/utils/telemetry";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

/**
 * 开发机上"缓存类"故障的处置提示（docs/00-dev-onboarding.md 常见问题）。
 *
 * 这类故障的共性是：**症状与原因隔着两层**——页面崩在一句听不懂的组件报错上，实际是依赖缓存
 * 被打成了两份；排查成本高，处置却只有一条命令。与其继续隐晦，不如在兜底页直接写出来。
 * 只在 DEV 生效：生产构建期打包不会出现两份实例，也不需要这条提示。
 */
export const CACHE_HINTS: ReadonlyArray<{ pattern: RegExp; hint: string }> = [
	{
		pattern: /MantineProvider was not found/i,
		hint: "依赖预打包缓存已损坏（同一份 @mantine/core 被打了两遍，Provider 与组件拿到的不是同一个 context）。执行 `pnpm run dev:clean` 后刷新即可 —— 不是代码问题。",
	},
	{
		pattern: /Outdated Optimize Dep|Failed to fetch dynamically imported module|Importing a module script failed/i,
		hint: "浏览器拿到的模块图已过期（通常是 dev server 重新优化依赖之后）。先刷新页面；仍不行则执行 `pnpm run dev:clean`。",
	},
];

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
			const cacheHint = import.meta.env.DEV
				? CACHE_HINTS.find((h) => h.pattern.test(this.state.error?.message ?? ""))?.hint
				: undefined;

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
					{cacheHint && (
						<Text size="sm" ta="center" maw={480} c="orange">
							{cacheHint}
						</Text>
					)}
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
								<Paper withBorder p="md" component="pre" style={{ maxHeight: 256, maxWidth: 600, overflow: "auto", textAlign: "left" }} >
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
