import { cn } from "@/utils/cn";

interface RingProgressProps {
	value: number;
	max: number;
	label: string;
	subtitle?: string;
	size?: number;
	strokeWidth?: number;
	className?: string;
}

function ringColor(pct: number): string {
	if (pct >= 80) return "text-success-foreground";
	if (pct >= 60) return "text-warning-foreground";
	return "text-danger-foreground";
}

export function RingProgress({
	value,
	max,
	label,
	subtitle,
	size = 100,
	strokeWidth = 8,
	className,
}: RingProgressProps) {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference - (pct / 100) * circumference;

	return (
		<div className={cn("flex flex-col items-center gap-2", className)}>
			<svg
				width={size}
				height={size}
				className="-rotate-90"
				role="img"
				aria-label={`${label}: ${pct}%`}
			>
				<title>{`${label}: ${pct}%`}</title>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth={strokeWidth}
					className="text-muted/30"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					className={ringColor(pct)}
					style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
				/>
			</svg>
			<div className="text-center">
				<div className={cn("text-2xl font-bold", ringColor(pct))}>
					{pct}%
				</div>
				<div className="text-[11px] text-muted-foreground">{label}</div>
				{subtitle && (
					<div className="text-xs text-muted-foreground mt-0.5">
						{subtitle}
					</div>
				)}
			</div>
		</div>
	);
}
