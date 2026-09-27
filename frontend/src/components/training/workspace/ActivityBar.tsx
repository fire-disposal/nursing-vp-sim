import { Badge, Box, Group, Text, UnstyledButton } from "@mantine/core";
import Bottomsheet from "@/components/ui/bottomsheet";
import { useWorkspaceHost } from "@/hooks/useLayoutMode";
import { ACTIVITY_ICONS, DEFAULT_ACTIVITY_ICON } from "@/config/activity-display";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ActivityPanelHost } from "./ActivityPanelHost";
import { activityStatus } from "./ActivityStatusBadge";
import {
	type WorkspacePane,
	useActivityArtifact,
	useDockPanes,
	useInitialActivityPanel,
	useWorkspacePanes,
} from "./useWorkspacePanes";

/**
 * 竖屏工作区：对话区上方的能力条 + 底部面板（Bottomsheet）。横屏走右侧栏（ActivityRail）。
 *
 * 与桌面侧栏共用 `workspaceStore` 的展开状态，因此旋转屏幕/调整窗口不会丢面板。
 * 按钮同时给出名称与服务端状态（未填写/草稿未提交/已提交），
 * 面板本体走同一套渲染器（RendererMap）与同一份 manifest。
 */
export default function ActivityBar() {
	const panes = useWorkspacePanes();
	const dockPanes = useDockPanes();
	const openPanelId = useWorkspaceStore((state) => state.openPanelId);
	const togglePanel = useWorkspaceStore((state) => state.togglePanel);
	const closePanel = useWorkspaceStore((state) => state.closePanel);
	const host = useWorkspaceHost();
	useInitialActivityPanel();

	// 只有竖屏（手机版）用底部抽屉；横屏改为右侧栏，避免把本就不高的视口再切一半
	if (host !== "sheet" || dockPanes.length === 0) return null;
	const active = panes.find((pane) => pane.id === openPanelId) ?? null;

	return (
		<>
			<Box
				component="nav"
				aria-label="训练能力条"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "6px 8px",
					borderTop: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-body)",
					flexShrink: 0,
					overflowX: "auto",
				}}
			>
				{dockPanes.map((pane) => (
					<ActivityBarButton
						key={pane.id}
						pane={pane}
						active={pane.id === openPanelId}
						onClick={() => togglePanel(pane.id)}
					/>
				))}
			</Box>

			{active && (
				<Bottomsheet open onClose={closePanel} title={active.label}>
					<ActivityPanelHost pane={active} onClose={closePanel} header={false} />
				</Bottomsheet>
			)}
		</>
	);
}

function ActivityBarButton({ pane, active, onClick }: { pane: WorkspacePane; active: boolean; onClick: () => void }) {
	const artifact = useActivityArtifact(pane.activity);
	const status = pane.activity ? activityStatus(pane.activity, artifact) : null;
	const Icon = ACTIVITY_ICONS[pane.id] ?? DEFAULT_ACTIVITY_ICON;

	return (
		<UnstyledButton
			onClick={onClick}
			aria-pressed={active}
			/* 触摸目标 ≥44px（拇指最容易误触的就是这排能力入口） */
			px="sm"
			style={{
				/* 触摸目标 ≥44px：用 px 写死，不随主题字号缩放 */
				height: 44,
				flexShrink: 0,
				borderRadius: "var(--mantine-radius-md)",
				border: `1px solid var(--mantine-color-${active ? "brand-outline" : "default-border"})`,
				background: active ? "var(--mantine-color-brand-light)" : "var(--mantine-color-body)",
			}}
		>
			<Group gap={6} wrap="nowrap">
				<Icon size={16} />
				<Text size="sm" fw={500}>
					{pane.label}
				</Text>
				{status && (
					<Badge size="xs" variant="light" color={status.color}>
						{status.label}
					</Badge>
				)}
			</Group>
		</UnstyledButton>
	);
}
