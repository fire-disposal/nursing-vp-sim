import { Box, Group, Text } from "@mantine/core";
import Bottomsheet from "@/components/ui/bottomsheet";
import { ACTIVITY_ICONS, DEFAULT_ACTIVITY_ICON } from "@/config/activity-display";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ActivityPanelHost } from "./ActivityPanelHost";
import { activityStatus } from "./ActivityStatusBadge";
import {
	type WorkspacePane,
	useActivityArtifact,
	useInitialActivityPanel,
	useWorkspacePanes,
} from "./useWorkspacePanes";

/**
 * 移动工作区（< lg）：对话区上方的能力条 + 底部面板（Bottomsheet）。
 *
 * 与桌面侧栏共用 `workspaceStore` 的展开状态，因此旋转屏幕/调整窗口不会丢面板。
 * 按钮同时给出名称与服务端状态（未填写/草稿未提交/已提交），
 * 面板本体走同一套渲染器（RendererMap）与同一份 manifest。
 */
export default function ActivityBar() {
	const panes = useWorkspacePanes();
	const openPanelId = useWorkspaceStore((state) => state.openPanelId);
	const togglePanel = useWorkspaceStore((state) => state.togglePanel);
	const closePanel = useWorkspaceStore((state) => state.closePanel);
	useInitialActivityPanel();

	if (panes.length === 0) return null;
	const active = panes.find((pane) => pane.id === openPanelId) ?? null;

	return (
		<>
			<Box
				component="nav"
				aria-label="训练能力面板"
				display={{ base: "flex", lg: "none" }}
				style={{
					alignItems: "center",
					gap: 6,
					padding: "6px 8px",
					borderTop: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-body)",
					flexShrink: 0,
					overflowX: "auto",
				}}
			>
				{panes.map((pane) => (
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
		<Box
			component="button"
			type="button"
			onClick={onClick}
			aria-pressed={active}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				flexShrink: 0,
				minHeight: 40,
				padding: "6px 10px",
				borderRadius: 8,
				cursor: "pointer",
				border: `1px solid var(--mantine-color-${active ? "brand-4" : "default-border"})`,
				background: active ? "var(--mantine-color-brand-0)" : "var(--mantine-color-body)",
			}}
		>
			<Icon size={16} />
			<Group gap={4} wrap="nowrap">
				<Text size="xs" fw={500}>
					{pane.label}
				</Text>
				{status && (
					<Text size="10px" c={status.color === "green" ? "green" : "orange"} fw={500}>
						{status.label}
					</Text>
				)}
			</Group>
		</Box>
	);
}
