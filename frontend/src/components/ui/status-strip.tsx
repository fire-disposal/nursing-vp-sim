import type { ReactNode } from "react";
import { Box, Group, Text } from "@mantine/core";

/**
 * StatusStrip —— 全站唯一的「条件性状态条」。
 *
 * 只承载**持续存在、与页面内容无关**的事实（断网、推送通道断开、额度耗尽）。
 * 渠道分工与判定口诀见 `docs/ops/notification-channels.md`。
 *
 * 三条硬约束：
 * - 高度固定（py 5 + 13px 字），文案单行截断，不因长短抖动，不并排两条；
 * - 常驻到条件消失，不给"关闭"（关了不代表网络恢复）；
 * - 浅底深字：白字压黄/红只有 ≈1.6–3:1，读不清。
 *
 * 部署更新那条跑马灯**不走这里**：它是运维窗口的特殊通道，必须不可忽略、不可关闭
 * （`components/Layout.tsx` 的 `DeployBanner`，刻意不并入）。
 */
export type StatusStripTone = "warn" | "danger";

const TONE = {
	warn: {
		background: "var(--mantine-color-yellow-1)",
		color: "var(--mantine-color-yellow-9)",
		border: "var(--mantine-color-yellow-3)",
	},
	danger: {
		background: "var(--mantine-color-red-1)",
		color: "var(--mantine-color-red-9)",
		border: "var(--mantine-color-red-3)",
	},
} as const;

export function StatusStrip({
	tone,
	icon,
	children,
	action,
	center = true,
}: {
	tone: StatusStripTone;
	icon?: ReactNode;
	children: ReactNode;
	/** 右侧附加动作（如「去充值」「重试」）；状态条本身不带关闭。 */
	action?: ReactNode;
	/** 默认居中（全宽条）；嵌在列里时可改为左对齐。 */
	center?: boolean;
}) {
	const palette = TONE[tone];
	return (
		<Box
			role="status"
			aria-live="polite"
			style={{
				flexShrink: 0,
				background: palette.background,
				color: palette.color,
				borderBottom: `1px solid ${palette.border}`,
				padding: "5px 12px",
			}}
		>
			<Group gap={8} wrap="nowrap" justify={center ? "center" : "flex-start"} align="center">
				{icon}
				<Text size="sm" fw={500} c="inherit" truncate style={{ minWidth: 0 }}>
					{children}
				</Text>
				{action}
			</Group>
		</Box>
	);
}
