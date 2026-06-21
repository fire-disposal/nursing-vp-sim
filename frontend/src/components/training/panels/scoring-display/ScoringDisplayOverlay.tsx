import type { MessageBus } from "@/engine/types";
import { ScoreCard } from "./ScoreCard";

export function ScoringDisplayOverlay({
	recordId,
	bus,
}: {
	recordId: string;
	bus: MessageBus;
}) {
	return <ScoreCard bus={bus} recordId={recordId} />;
}
