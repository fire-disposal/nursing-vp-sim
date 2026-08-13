import { Alert, Button } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import type { ComponentType } from "react";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface ErrorDisplayProps {
	icon?: IconType;
	message: string;
	onRetry?: () => void;
}

/**
 * Shared error state display — consistent icon + message + optional retry.
 */
export default function ErrorDisplay({
	icon: Icon = IconAlertTriangle,
	message,
	onRetry,
}: ErrorDisplayProps) {
	return (
		<Alert
			variant="light"
			color="red"
			icon={<Icon size={20} />}
			style={{ justifyContent: "center", textAlign: "center" }}
			py="xl"
		>
			{message}
			{onRetry && (
				<Button variant="outline" size="sm" onClick={onRetry} leftSection={<IconRefresh size={14} />} mt="md">
					重试
				</Button>
			)}
		</Alert>
	);
}
