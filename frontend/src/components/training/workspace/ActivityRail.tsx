import { ActionIcon, Box, Indicator, Text, Tooltip } from "@mantine/core";
import { ACTIVITY_ICONS, DEFAULT_ACTIVITY_ICON } from "@/config/activity-display";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useWorkspaceHost } from "@/hooks/useLayoutMode";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ActivityPanelHost } from "./ActivityPanelHost";
import { activityStatus } from "./ActivityStatusBadge";
import { ACTIVITY_PANEL_WIDTH } from "./renderers";
import {
	type WorkspacePane,
	useActivityArtifact,
	useInitialActivityPanel,
	useWorkspacePanes,
} from "./useWorkspacePanes";

const ANIM_DURATION = 200;

/**
 * 右侧栏工作区（宽度 ≥ lg 或横屏）：Activity 侧栏 + 展开面板。
 *
 * 导航项**只来自** `manifest.activities` 中服务端标为 available 的项
 * （+ 引导模式的问诊清单视图）。没有任何可用面板时整块不占位，
 * 对话区保持全宽——这是「本病例未开放床旁能力」的空态。
 */
export function ActivityRail() {
	const panes = useWorkspacePanes();
	const openPanelId = useWorkspaceStore((state) => state.openPanelId);
	const togglePanel = useWorkspaceStore((state) => state.togglePanel);
	const closePanel = useWorkspaceStore((state) => state.closePanel);
	const isShort = useShortViewport();
	const host = useWorkspaceHost();
	// 视口不到 lg 时强制窄面板：横屏手机/窄窗口也要给对话区留出位置
	const wideViewport = useMediaQuery("(min-width: 1200px)");
	useInitialActivityPanel();

	// 工作区是顶栏（absolute，全宽）的兄弟节点，必须自己让出顶栏高度，
	// 否则第一个导航项会被顶栏盖住点不到。
	const headerOffset = isShort ? 36 : 44;

	// 宿主判定由 useWorkspaceHost 单点给出（横屏也走右侧栏，不再依赖 CSS 宽度断点）
	if (host !== "rail" || panes.length === 0) return null;

	const active = panes.find((pane) => pane.id === openPanelId) ?? null;
	const width = active
		? active.wide && wideViewport
			? ACTIVITY_PANEL_WIDTH.wide
			: ACTIVITY_PANEL_WIDTH.narrow
		: 0;

	return (
		<Box style={{ flexShrink: 0, height: "100%", display: "flex" }}>
			<Box
				style={{
					width,
					transition: `width ${ANIM_DURATION}ms ease-out`,
					height: "100%",
					display: "flex",
					flexDirection: "column",
					borderLeft: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-body)",
					overflow: "hidden",
					paddingTop: headerOffset,
					opacity: active ? 1 : 0,
				}}
			>
				{active && <ActivityPanelHost pane={active} onClose={closePanel} />}
			</Box>

			<Box
				component="nav"
				aria-label="训练能力侧栏"
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 4,
					borderLeft: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-body)",
					padding: `0 4px 8px`,
					paddingTop: headerOffset + 8,
					height: "100%",
					overflowY: "auto",
				}}
			>
				{panes.map((pane) => (
					<ActivityRailButton
						key={pane.id}
						pane={pane}
						active={pane.id === openPanelId}
						onClick={() => togglePanel(pane.id)}
					/>
				))}
			</Box>
		</Box>
	);
}

function ActivityRailButton({
	pane,
	active,
	onClick,
}: {
	pane: WorkspacePane;
	active: boolean;
	onClick: () => void;
}) {
	const artifact = useActivityArtifact(pane.activity);
	const status = pane.activity ? activityStatus(pane.activity, artifact) : null;
	const Icon = ACTIVITY_ICONS[pane.id] ?? DEFAULT_ACTIVITY_ICON;
	const hint = status ? `${pane.label}（${status.label}）` : pane.label;
	const statusColor = status?.color === "green" ? "green" : status?.color === "gray" ? "dimmed" : "orange";

	return (
		<Tooltip label={hint} position="left" withArrow>
			<Box style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
				<Indicator
					disabled={!status || status.color === "green"}
					color={status?.color ?? "gray"}
					size={8}
					offset={4}
					position="top-end"
				>
					<ActionIcon
						variant={active ? "light" : "default"}
						color={active ? undefined : "gray"}
						size={36}
						radius="md"
						onClick={onClick}
						aria-label={hint}
						aria-pressed={active}
					>
						<Icon size={16} />
					</ActionIcon>
				</Indicator>
				{/* 产物状态在桌面端必须**可见**，不能只藏在 tooltip 里（docs/19 E5）：
				    草稿/未填写 = 还没提交，会挡住结束训练。 */}
				{status && (
					<Text size="9px" fw={600} c={statusColor} style={{ lineHeight: 1 }}>
						{status.short}
					</Text>
				)}
			</Box>
		</Tooltip>
	);
}
