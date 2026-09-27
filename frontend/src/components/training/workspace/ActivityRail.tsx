import { ActionIcon, Box, Drawer, Indicator, Stack, Text, Tooltip } from "@mantine/core";
import { ACTIVITY_ICONS, DEFAULT_ACTIVITY_ICON } from "@/config/activity-display";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useWorkspaceHost } from "@/hooks/useLayoutMode";
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

/** 工具列宽度：图标 + 可读标签（不做 9px 微字） */
const RAIL_WIDTH = 72;

/**
 * 桌面工作区：**工具列 + 侧滑面板**（宽度 ≥ lg，或横屏）。
 *
 * 与旧结构的区别（需求出发）：
 *
 * - 面板用 Mantine `Drawer`（右侧、无遮罩）**覆盖**对话区，而不是把对话列挤窄 ——
 *   开面板时对话仍在原位，关掉即恢复，不再有"一开面板聊天就变形"的抖动；
 * - 工具列项给**可读标签**（图标 + 12px 文字），状态用角标点（颜色）+ tooltip/aria 承载，
 *   不再在图标下压一行 9px 的"未填写"；
 * - 入口只列本次训练真正可用的能力（`manifest.activities`）。问诊清单的入口在患者条/上下文列的
 *   进度 chip 上，这里不重复（`useDockPanes`）。
 */
export function ActivityRail() {
	const panes = useWorkspacePanes();
	const dockPanes = useDockPanes();
	const openPanelId = useWorkspaceStore((state) => state.openPanelId);
	const togglePanel = useWorkspaceStore((state) => state.togglePanel);
	const closePanel = useWorkspaceStore((state) => state.closePanel);
	const isShort = useShortViewport();
	const host = useWorkspaceHost();
	// 视口不到 lg 时用窄面板：横屏手机/窄窗口也要给对话区留位置
	const wideViewport = useMediaQuery("(min-width: 1200px)");
	useInitialActivityPanel();

	const headerOffset = isShort ? 36 : 44;
	if (host !== "rail" || dockPanes.length === 0) return null;

	const active = panes.find((pane) => pane.id === openPanelId) ?? null;

	return (
		<>
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

			<Drawer
				opened={active !== null}
				onClose={closePanel}
				position="right"
				size={active?.wide && wideViewport ? 560 : 400}
				withOverlay={false}
				withCloseButton={false}
				padding={0}
				styles={{
					// 面板整块下移到顶栏之下：开面板时顶栏（计时 / 采集进度 / 结束训练）仍然可用。
					// 注意定位的是 `inner`（绝对定位的包裹层），设 `content.top` 不会生效。
					inner: { top: headerOffset, height: `calc(100% - ${headerOffset}px)` },
					// 标题由面板自己的头承担（带状态徽章与关闭按钮），Drawer 自带的头会重复一遍
					header: { display: "none" },
					body: { height: "100%", display: "flex", flexDirection: "column" },
				}}
			>
				{active && <ActivityPanelHost pane={active} onClose={closePanel} />}
			</Drawer>
		</>
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
		<Tooltip label={hint} position="left" withArrow openDelay={300}>
			<Box w="100%">
				<Indicator
					disabled={!status || status.color === "green"}
					color={status?.color ?? "gray"}
					size={8}
					offset={4}
					position="top-end"
				>
					<ActionIcon
						variant={active ? "light" : "subtle"}
						color={active ? undefined : "gray"}
						w="100%"
						radius="md"
						/* 触摸/点击目标 60px 高：图标 + 标签整体可点 */
						style={{ height: 60 }}
						onClick={onClick}
						aria-label={hint}
						aria-pressed={active}
					>
						<Stack gap={2} align="center">
							<Icon size={20} />
							<Text size="11px" fw={600} lh={1} c={active ? "brand.7" : "dimmed"} ta="center">
								{pane.label}
							</Text>
						</Stack>
					</ActionIcon>
				</Indicator>
			</Box>
		</Tooltip>
	);
}
