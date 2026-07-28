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
		<div
			role="alert"
			className={cn(
				"mb-4 rounded-lg px-3.5 py-2.5 text-sm",
				type === "success"
					? "bg-success text-success-foreground"
					: "bg-destructive/10 text-destructive",
				className,
			)}
		>
			{message}
		</div>
	);
}

export default FormMessageBanner;
