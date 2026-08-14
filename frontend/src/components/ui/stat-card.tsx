import { Paper, Text, ThemeIcon } from "@mantine/core";
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
			style={{ display: "flex", alignItems: "center", gap: "1rem", cursor: onClick ? "pointer" : undefined }}
		>
			{Icon && (
				<ThemeIcon size={44} radius="md" variant="light" color={COLOR_MAP[color]}>
					<Icon size={20} />
				</ThemeIcon>
			)}
			<div style={{ minWidth: 0 }}>
				<Text size="xl" fw={700} lh={1.1}>
					{value ?? "-"}
				</Text>
				<Text size="sm" c="dimmed" mt={2}>
					{label}
				</Text>
				{trend !== undefined && trend !== 0 && (
					<Text size="xs" fw={500} mt={2} c={trend > 0 ? "green" : "red"}>
						{trend > 0 ? "\u2191" : "\u2193"} {Math.abs(trend)}%
					</Text>
				)}
			</div>
		</Paper>
	);
}
