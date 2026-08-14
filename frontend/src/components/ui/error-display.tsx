import { Button, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import type { ComponentType } from "react";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface ErrorDisplayProps {
	icon?: IconType;
	message: string;
	onRetry?: () => void;
}

/**
 * ErrorDisplay — 居中错误空态（与 EmptyState 同一视觉语言）。
 * 图标瓷片 + 错误文案 + 可选重试按钮，全部垂直居中。
 */
export default function ErrorDisplay({
	icon: Icon = IconAlertTriangle,
	message,
	onRetry,
}: ErrorDisplayProps) {
	return (
		<Stack align="center" justify="center" py={48} ta="center" gap="sm">
			<ThemeIcon size={56} variant="light" color="red" radius="md">
				<Icon size={26} strokeWidth={1.5} />
			</ThemeIcon>
			<Text size="sm" fw={600} c="gray.8">
				{message}
			</Text>
			{onRetry && (
				<Button
					variant="outline"
					size="sm"
					onClick={onRetry}
					leftSection={<IconRefresh size={14} />}
					mt="xs"
				>
					重试
				</Button>
			)}
		</Stack>
	);
}
