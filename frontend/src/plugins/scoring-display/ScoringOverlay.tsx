import { useEffect, useState } from "react";
import type { MessageBus } from "@/engine/types";

export function ScoringOverlay({ bus }: { bus: MessageBus }) {
	const [progress, setProgress] = useState(0);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const unsub = bus.on("training:ended", () => {
			setVisible(true);
			setProgress(10);
		});
		return unsub;
	}, [bus]);

	useEffect(() => {
		if (!visible) return;
		const id = setInterval(() => {
			setProgress((p) => (p >= 95 ? 95 : p + 1));
		}, 200);
		return () => clearInterval(id);
	}, [visible]);

	useEffect(() => {
		const unsub = bus.on("score:ready", () => {
			setProgress(100);
			setTimeout(() => setVisible(false), 500);
		});
		return unsub;
	}, [bus]);

	if (!visible) return null;

	return (
		<div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background/90">
			<p className="mb-4 text-lg font-medium">正在评估训练表现...</p>
			<div className="h-2 w-64 rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary transition-all duration-200"
					style={{ width: `${progress}%` }}
				/>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">{progress}%</p>
		</div>
	);
}
