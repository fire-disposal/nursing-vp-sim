import { useEffect, useState } from "react";
import type { MessageBus } from "@/engine/types";
import { cn } from "@/lib/utils";

interface InitiativeBarProps {
	bus: MessageBus;
	features: Record<string, boolean>;
}

export function InitiativeBar({ bus, features }: InitiativeBarProps) {
	const [percent, setPercent] = useState(0);

	useEffect(() => {
		const unsub = bus.on(
			"initiative:state",
			(data: { percent?: number }) => {
				setPercent(data.percent ?? 0);
			},
		);
		return unsub;
	}, [bus]);

	const barColor =
		percent > 80
			? "bg-destructive"
			: percent > 50
				? "bg-amber-500"
				: "bg-green-500";

	return (
		<div
			className={cn(
				"shrink-0 bg-muted/30 transition-all duration-300 overflow-hidden",
				features.patient_initiative ? "h-1" : "h-0",
			)}
		>
			<div
				className={cn(
					"h-full rounded-full transition-all duration-1000",
					barColor,
				)}
				style={{ width: `${Math.min(100, percent)}%` }}
			/>
		</div>
	);
}
