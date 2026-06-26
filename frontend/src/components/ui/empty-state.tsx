import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

interface EmptyStateProps {
	icon?: LucideIcon;
	title: string;
	description?: string;
	action?: React.ReactNode;
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
		<div
			className={cn(
				"flex flex-col items-center justify-center py-12 text-center",
				className,
			)}
		>
			{Icon && <Icon size={48} className="mb-4 text-muted-foreground/50" />}
			<p className="text-sm font-medium text-muted-foreground">{title}</p>
			{description && (
				<p className="mt-1 text-xs text-muted-foreground/70">{description}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}
