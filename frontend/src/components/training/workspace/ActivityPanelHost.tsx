import { Suspense } from "react";
import { ActionIcon, Box, Group, Loader, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useTrainingStore } from "@/stores/trainingStore";
import InquiryTool from "../tools/InquiryTool";
import { ActivityStatusBadge } from "./ActivityStatusBadge";
import { ACTIVITY_RENDERERS } from "./renderers";
import { type WorkspacePane, useActivityArtifact } from "./useWorkspacePanes";

/**
 * 面板宿主 —— 面板外壳（标题/状态/关闭）+ 渲染边界。
 *
 * 渲染器缺失时**显式报错**而不是静默消失（docs/15 §十五：不允许「配了但不可达」）；
 * 面板自身的加载/失败/冲突态由面板内部负责（如护理评估的草稿/提交/冻结冲突）。
 */
export function ActivityPanelHost({
	pane,
	onClose,
	header = true,
}: {
	pane: WorkspacePane;
	onClose: () => void;
	/** 移动端底部面板自带标题栏，可关闭宿主头部避免重复 */
	header?: boolean;
}) {
	const bus = useTrainingStore((state) => state.bus);
	const recordId = useTrainingStore((state) => state.recordId);
	const artifact = useActivityArtifact(pane.activity);
	if (!bus) return null;

	const Renderer = pane.activity ? ACTIVITY_RENDERERS[pane.activity.ui.renderer] ?? null : null;

	return (
		<>
			{header && (
				<Group
				justify="space-between"
				wrap="nowrap"
				px="sm"
				py={8}
				style={{
					borderBottom: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-gray-0)",
					flexShrink: 0,
				}}
			>
				<Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
					<Text size="xs" fw={600} truncate>
						{pane.label}
					</Text>
					{pane.activity && <ActivityStatusBadge activity={pane.activity} artifact={artifact} />}
				</Group>
				<ActionIcon
					variant="subtle"
					color="gray"
					size="sm"
					onClick={onClose}
					title="收起面板"
					aria-label={`收起${pane.label}`}
				>
					✕
				</ActionIcon>
			</Group>
			)}

			<Box style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
				<ErrorBoundary
					fallback={
						<Stack align="center" gap={8} p="md">
							<Text size="sm" c="dimmed">
								{pane.label}渲染出错，请刷新页面重试
							</Text>
						</Stack>
					}
				>
					<Suspense
						fallback={
							<Group h={120} justify="center" align="center" gap="xs" c="dimmed">
								<Loader size="sm" />
								<Text size="sm">加载面板…</Text>
							</Group>
						}
					>
						{pane.activity ? (
							Renderer ? (
								<Renderer
									activity={pane.activity}
									bus={bus}
									recordId={recordId}
								/>
							) : (
								<Stack align="center" gap={6} p="lg" c="dimmed" ta="center">
									<IconAlertTriangle size={18} />
									<Text size="sm" fw={500}>
										{pane.label}暂无可用的界面组件
									</Text>
									<Text size="xs">
										渲染器 “{pane.activity.ui.renderer}” 未注册，请联系管理员
									</Text>
								</Stack>
							)
						) : (
							<InquiryTool />
						)}
					</Suspense>
				</ErrorBoundary>
			</Box>
		</>
	);
}
