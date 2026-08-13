import { Alert } from "@mantine/core";
import { cn } from "@/lib/utils";

interface FormMessageBannerProps {
	type?: "success" | "error";
	message: string | null | undefined;
	className?: string;
}

/**
 * Shared inline success/error banner for forms and dialogs.
 * Renders nothing when `message` is empty.
 */
export function FormMessageBanner({
	type = "error",
	message,
	className,
}: FormMessageBannerProps) {
	if (!message) return null;
	return (
		<Alert
			role="alert"
			variant="light"
			color={type === "success" ? "green" : "red"}
			mb="md"
			className={cn(className)}
		>
			{message}
		</Alert>
	);
}

export default FormMessageBanner;
