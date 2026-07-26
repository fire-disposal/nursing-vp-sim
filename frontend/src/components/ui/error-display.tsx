import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import Button from "./button";

interface ErrorDisplayProps {
	icon?: LucideIcon;
	message: string;
	onRetry?: () => void;
}

/**
 * Shared error state display — consistent icon + message + optional retry.
 * Replaces the inline error div pattern duplicated across multiple pages.
 */
export default function ErrorDisplay({
	icon: Icon = AlertTriangle,
	message,
	onRetry,
}: ErrorDisplayProps) {
	return (
		<div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl border bg-card">
			<Icon size={40} className="text-muted-foreground/40" />
			<p className="text-sm text-destructive max-w-sm text-center">{message}</p>
			{onRetry && (
				<Button variant="outline" size="sm" onClick={onRetry}>
					<RefreshCw size={14} />
					重试
				</Button>
			)}
		</div>
	);
}
