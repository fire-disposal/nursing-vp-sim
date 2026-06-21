import { useEffect, useRef, useState } from "react";
import type { MessageBus } from "@/engine/types";
import { cn } from "@/lib/utils";

interface InitiativeBarProps {
	bus: MessageBus;
	features: Record<string, boolean>;
}

export function InitiativeBar({ bus, features }: InitiativeBarProps) {
	const [percent, setPercent] = useState(0);
	const elapsedRef = useRef(0);
	const thresholdRef = useRef(30);
	const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		const unsub = bus.on(
			"initiative:state",
			(data: { elapsed_seconds?: number; threshold_seconds?: number; percent?: number }) => {
				elapsedRef.current = data.elapsed_seconds ?? 0;
				thresholdRef.current = data.threshold_seconds ?? 30;
				setPercent(data.percent ?? 0);
				// Start client-side tick between SSE updates
				if (tickRef.current) clearInterval(tickRef.current);
				tickRef.current = setInterval(() => {
					elapsedRef.current += 1;
					const pct = Math.min(100, Math.round((elapsedRef.current / thresholdRef.current) * 100));
					setPercent(pct);
				}, 1000);
			},
		);
		return () => {
			unsub();
			if (tickRef.current) clearInterval(tickRef.current);
		};
	}, [bus]);

	const barColor =
		percent > 80
			? "bg-destructive"
			: percent > 50
				? "bg-amber-500"
				: "bg-green-500";

	return (
		<div
			className="shrink-0 bg-muted/30 overflow-hidden transition-all duration-300"
			style={{ maxHeight: features.patient_initiative ? "4px" : "0" }}
		>
			<div className="h-1 w-full">
				<div
					className={cn(
						"h-full rounded-full transition-all duration-1000",
						barColor,
					)}
					style={{ width: `${Math.min(100, percent)}%` }}
				/>
			</div>
		</div>
	);
}
