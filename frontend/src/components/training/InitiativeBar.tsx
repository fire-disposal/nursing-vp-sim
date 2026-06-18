import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface InitiativeBarProps {
	bus: {
		on: (
			event: string,
			handler: (...args: any[]) => void,
		) => () => void;
	};
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

	if (!features.patient_initiative) return null;

	const barColor =
		percent > 80
			? "bg-destructive"
			: percent > 50
				? "bg-amber-500"
				: "bg-green-500";

	return (
		<div className="shrink-0 h-1 bg-muted/30">
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
