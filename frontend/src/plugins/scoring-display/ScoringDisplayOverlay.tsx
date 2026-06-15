import type { MessageBus } from "@/engine/types";
import { ScoreCard } from "./ScoreCard";
import { ScoringOverlay } from "./ScoringOverlay";

export function ScoringDisplayOverlay({
	recordId,
	bus,
}: {
	recordId: string;
	bus: MessageBus;
	features: Record<string, boolean>;
}) {
	return (
		<>
			<ScoringOverlay bus={bus} />
			<ScoreCard bus={bus} recordId={recordId} />
		</>
	);
}
