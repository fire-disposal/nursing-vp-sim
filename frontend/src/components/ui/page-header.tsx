import { ChevronLeft } from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";

interface PageHeaderProps {
	title: string;
	subtitle?: string;
	icon?: ElementType;
	actions?: ReactNode;
	backTo?: string;
	className?: string;
}

export default function PageHeader({
	title,
	subtitle,
	icon: Icon,
	actions,
	backTo,
	className,
}: PageHeaderProps) {
	const navigate = useNavigate();

	return (
		<div className={cn("mb-3 sm:mb-6", className)}>
			{backTo && (
				<div className="mb-2">
					<button
						type="button"
						onClick={() => navigate(backTo)}
						className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 cursor-pointer"
					>
						<ChevronLeft size={14} />
						返回
					</button>
				</div>
			)}
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="flex items-center gap-2 text-lg sm:text-xl font-bold text-foreground">
						{Icon && <Icon size={22} />}
						{title}
					</h1>
					{subtitle && (
						<p className="hidden sm:block mt-1 text-sm text-muted-foreground">
							{subtitle}
						</p>
					)}
				</div>
				{actions && (
					<div className="flex shrink-0 items-center gap-2">{actions}</div>
				)}
			</div>
		</div>
	);
}
