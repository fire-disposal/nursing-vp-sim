import { Stack, Text, ThemeIcon } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface EmptyStateProps {
	icon?: IconType;
	title: string;
	description?: string;
	action?: ReactNode;
	className?: string;
}

export default function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	className,
}: EmptyStateProps) {
	return (
		<Stack align="center" justify="center" py={48} ta="center" className={cn(className)}>
			{Icon && (
				<ThemeIcon size={56} variant="light" color="gray" radius="xl">
					<Icon size={28} strokeWidth={1.5} />
				</ThemeIcon>
			)}
			<Text size="sm" fw={500} c="dimmed">
				{title}
			</Text>
			{description && (
				<Text size="xs" c="dimmed" opacity={0.7}>
					{description}
				</Text>
			)}
			{action && <div style={{ marginTop: "0.5rem" }}>{action}</div>}
		</Stack>
	);
}
