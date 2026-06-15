import { definePlugin } from "@/engine/types";
import { ScoringDisplayOverlay } from "./ScoringDisplayOverlay";

export default definePlugin({
	id: "scoring-display",
	meta: { name: "评分展示", description: "训练评分和反馈" },
	overlayComponent: ScoringDisplayOverlay,
});

export { ScoreCard } from "./ScoreCard";
export { ScoringOverlay } from "./ScoringOverlay";
