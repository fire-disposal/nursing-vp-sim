import { Box, Stack, Text, ThemeIcon } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface EmptyStateProps {
	icon?: IconType;
	title: string;
	description?: string;
	action?: ReactNode;
	className?: string;
}

/**
 * EmptyState — 空态：柔和图标瓷片 + 两级文案 + 可选动作。
 */
export default function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	className,
}: EmptyStateProps) {
	return (
		<Stack align="center" justify="center" py={48} ta="center" className={className}>
			{Icon && (
				<ThemeIcon
					size={56}
					variant="default"
					color="gray"
					radius="md"
					style={{ borderStyle: "dashed" }}
				>
					<Icon size={26} strokeWidth={1.5} />
				</ThemeIcon>
			)}
			<Text size="sm" fw={600} c="gray.8">
				{title}
			</Text>
			{description && (
				<Text size="xs" c="dimmed" maw={320} lh={1.6}>
					{description}
				</Text>
			)}
			{action && <Box mt={4}>{action}</Box>}
		</Stack>
	);
}
