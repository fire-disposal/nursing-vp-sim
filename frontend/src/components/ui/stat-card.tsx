import type { ElementType, ReactNode } from "react";
import { cn } from "@/utils/cn";

type StatColor = "blue" | "green" | "amber" | "red" | "teal";

const colorClasses: Record<StatColor, { bg: string; color: string }> = {
	blue: {
		bg: "bg-info text-info-foreground",
		color: "",
	},
	green: {
		bg: "bg-success text-success-foreground",
		color: "",
	},
	amber: {
		bg: "bg-warning text-warning-foreground",
		color: "",
	},
	red: {
		bg: "bg-danger text-danger-foreground",
		color: "",
	},
	teal: {
		bg: "bg-accent text-accent-foreground",
		color: "",
	},
};

interface StatCardProps {
	icon?: ElementType;
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
	const c = colorClasses[color] || colorClasses.blue;

	return (
		<div
			onClick={onClick}
			className={cn(
				"flex items-center gap-4 rounded-xl ring-1 ring-foreground/10 bg-card p-4 transition-all",
				onClick && "cursor-pointer hover:border-primary hover:shadow-e1",
				className,
			)}
		>
			{Icon && (
				<div
					className={cn(
						"flex size-11 shrink-0 items-center justify-center rounded-lg",
						c.bg,
					)}
				>
					<Icon size={20} />
				</div>
			)}
			<div className="min-w-0">
				<div className="text-xl font-bold leading-tight text-foreground">
					{value ?? "-"}
				</div>
				<div className="mt-0.5 text-sm text-muted-foreground">{label}</div>
				{trend !== undefined && trend !== 0 && (
					<div
						className={cn(
							"mt-0.5 text-xs font-medium",
							trend > 0 ? "text-success-foreground" : "text-destructive",
						)}
					>
						{trend > 0 ? "\u2191" : "\u2193"} {Math.abs(trend)}%
					</div>
				)}
			</div>
		</div>
	);
}
