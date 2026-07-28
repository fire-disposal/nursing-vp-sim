import { cn } from "@/lib/utils";

export interface ActivityEvent {
	id: string | number;
	time: string;
	studentName: string;
	action: string;
	meta?: string;
	metaColor?: "green" | "amber" | "red";
}

const metaColorClasses: Record<string, string> = {
	green: "bg-success text-success-foreground",
	amber: "bg-warning text-warning-foreground",
	red: "bg-danger text-danger-foreground",
};

interface ActivityTimelineProps {
	events: ActivityEvent[];
	className?: string;
}

export function ActivityTimeline({
	events,
	className,
}: ActivityTimelineProps) {
	if (events.length === 0) {
		return (
			<div
				className={cn(
					"py-8 text-center text-sm text-muted-foreground",
					className,
				)}
			>
				暂无最近动态
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col", className)}>
			{events.map((event) => (
				<div
					key={event.id}
					className="flex items-start gap-3 py-2.5"
				>
					<span className="shrink-0 text-xs text-muted-foreground tabular-nums w-10 text-right pt-0.5">
						{event.time}
					</span>
					<div className="relative flex items-center pt-0.5">
						<div className="size-2 rounded-full bg-muted-foreground/30 ring-2 ring-background" />
					</div>
					<div className="flex-1 min-w-0">
						<span className="text-sm">
							<span className="font-medium">
								{event.studentName}
							</span>
							<span className="text-muted-foreground">
								{" "}
								{event.action}
							</span>
						</span>
						{event.meta && (
							<span
								className={cn(
									"ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
									event.metaColor
										? metaColorClasses[event.metaColor]
										: "bg-secondary text-secondary-foreground",
								)}
							>
								{event.meta}
							</span>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
