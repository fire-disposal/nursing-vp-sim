import { Box, Paper, Text, ThemeIcon } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";

type StatColor = "blue" | "green" | "amber" | "red";

const COLOR_MAP: Record<StatColor, string> = {
	blue: "blue",
	green: "green",
	amber: "yellow",
	red: "red",
};

interface StatCardProps {
	icon?: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
	value?: ReactNode;
	label: string;
	color?: StatColor;
	trend?: number;
	onClick?: () => void;
	className?: string;
}

/**
 * StatCard — 业务数字卡片。
 * 数字一眼可读：大号 tabular-nums，标签弱化；趋势用小徽章表达。
 */
export default function StatCard({
	icon: Icon,
	value,
	label,
	color = "blue",
	trend,
	onClick,
	className,
}: StatCardProps) {
	return (
		<Paper
			withBorder
			radius="md"
			p="md"
			className={className}
			style={{
				display: "flex",
				alignItems: "center",
				gap: "0.875rem",
				cursor: onClick ? "pointer" : undefined,
				transition: "box-shadow 150ms ease, transform 150ms ease",
				...(onClick
					? {
							":hover": {
								boxShadow: "var(--mantine-shadow-sm)",
								transform: "translateY(-1px)",
							},
						}
					: {}),
			}}
		>
			{Icon && (
				<ThemeIcon size={44} radius="md" variant="light" color={COLOR_MAP[color]}>
					<Icon size={20} strokeWidth={1.8} />
				</ThemeIcon>
			)}
			<Box style={{ minWidth: 0 }}>
				<Text
					fz={26}
					fw={700}
					lh={1.15}
					className="tabular-nums"
					style={{ color: "var(--mantine-color-text)" }}
				>
					{value ?? "-"}
				</Text>
				<Text size="xs" c="dimmed" mt={2}>
					{label}
				</Text>
				{trend !== undefined && trend !== 0 && (
					<Box mt={4}>
						<Text
							size="xs"
							fw={600}
							c={trend > 0 ? "green" : "red"}
							style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
						>
							{trend > 0 ? "↑" : "↓"} {Math.abs(trend)}%
						</Text>
					</Box>
				)}
			</Box>
		</Paper>
	);
}
