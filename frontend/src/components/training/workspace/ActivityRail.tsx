import { ActionIcon, Box, Indicator, Stack, Tooltip } from "@mantine/core";
import { ACTIVITY_ICONS, DEFAULT_ACTIVITY_ICON } from "@/config/activity-display";
import { WIDTH } from "@/config/layout-scale";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useIsMobile } from "@/hooks/useLayoutMode";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useWorkspaceHost } from "@/hooks/useLayoutMode";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ActivityPanelHost } from "./ActivityPanelHost";
import { activityStatus } from "./ActivityStatusBadge";
import { TRAINING_HEADER_HEIGHT } from "../TrainingHeader";
import {
	type WorkspacePane,
	useActivityArtifact,
	useDockPanes,
	useInitialActivityPanel,
	useWorkspacePanes,
} from "./useWorkspacePanes";

/** 工具列宽度：只放图标（标签由 Tooltip 与面板头承担），把宽度留给对话列 */
const RAIL_WIDTH = 48;
/** 面板宽度：窄视口 360，宽视口且面板需要更宽时 560 */
const PANEL_WIDTH = { narrow: 360, wide: 560 };
const ANIM_DURATION = 200;

/**
 * 桌面工作区：**工具列 + 常驻面板（Aside）**（宽度 ≥ lg，或横屏）。
 *
 * 采纳外部评审的方向一：
 *
 * - 面板是**非模态的常驻侧栏**（`data-activity-aside`），挤压对话列而不是盖住它 ——
 *   学生可以边看检查项边与患者对话，这正是训练场景需要的；
 * - 工具列 48px 只放图标：标签进 Tooltip，**激活项用实心 brand**（与面板左边框相接，
 *   建立"面板是谁打开的"这一层视觉连接）；
 * - 入口只列本次训练真正可用的能力（`manifest.activities`）。问诊清单的入口在患者卡的进度
 *   chip 上，这里不重复（`useDockPanes`）。
 */
export function ActivityRail() {
	const panes = useWorkspacePanes();
	const dockPanes = useDockPanes();
	const openPanelId = useWorkspaceStore((state) => state.openPanelId);
	const togglePanel = useWorkspaceStore((state) => state.togglePanel);
	const closePanel = useWorkspaceStore((state) => state.closePanel);
	const isShort = useShortViewport();
	const isMobile = useIsMobile();
	const host = useWorkspaceHost();
	// 视口不到 lg 时用窄面板：横屏手机/窄窗口也要给对话区留位置
	const wideViewport = useMediaQuery(`(min-width: ${WIDTH.rail}px)`);
	useInitialActivityPanel();

	const headerOffset = isShort || isMobile ? TRAINING_HEADER_HEIGHT.short : TRAINING_HEADER_HEIGHT.wide;
	if (host !== "rail" || dockPanes.length === 0) return null;

	const active = panes.find((pane) => pane.id === openPanelId) ?? null;
	const panelWidth = active ? (active.wide && wideViewport ? PANEL_WIDTH.wide : PANEL_WIDTH.narrow) : 0;

	return (
		<Box style={{ display: "flex", flexShrink: 0, height: "100%", minWidth: 0 }}>
			<Stack
				component="nav"
				aria-label="训练能力侧栏"
				gap={6}
				align="center"
				w={RAIL_WIDTH}
				h="100%"
				bg="var(--mantine-color-body)"
				style={{ flexShrink: 0, borderLeft: "1px solid var(--mantine-color-default-border)", overflowY: "auto" }}
				p="xs"
				pt={headerOffset + 8}
			>
				{dockPanes.map((pane) => (
					<ActivityRailButton
						key={pane.id}
						pane={pane}
						active={pane.id === openPanelId}
						onClick={() => togglePanel(pane.id)}
					/>
				))}
			</Stack>

			{/* 常驻面板：非模态、挤压对话列；收起时宽度归零不占位 */}
			<Box
				data-activity-aside
				data-open={active ? "true" : "false"}
				bg="var(--mantine-color-body)"
				style={{
					width: panelWidth,
					flexShrink: 0,
					height: "100%",
					display: "flex",
					flexDirection: "column",
					transition: `width ${ANIM_DURATION}ms ease-out`,
					overflow: "hidden",
					borderLeft: active ? "1px solid var(--mantine-color-default-border)" : undefined,
					paddingTop: headerOffset,
				}}
			>
				{active && <ActivityPanelHost pane={active} onClose={closePanel} />}
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

	return (
		<Tooltip label={hint} position="left" withArrow openDelay={200}>
			<ActionIcon
				/* 触摸/点击目标 ≥44px：图标 + 命中区整体可点 */
				size={44}
				radius="md"
				variant={active ? "filled" : "subtle"}
				color={active ? "brand" : "gray"}
				onClick={onClick}
				aria-label={hint}
				aria-pressed={active}
				style={{ width: "100%", height: 44 }}
			>
				<Indicator
					disabled={!status || status.color === "green"}
					color={status?.color ?? "gray"}
					size={8}
					offset={6}
					position="top-end"
				>
					<Icon size={20} />
				</Indicator>
			</ActionIcon>
		</Tooltip>
	);
}
