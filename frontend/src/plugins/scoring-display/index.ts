import { definePlugin } from "@/engine/types";

export default definePlugin({
	id: "scoring-display",
	meta: { name: "评分展示", description: "训练评分和反馈" },
});

export { ScoreCard } from "./ScoreCard";
export { ScoringOverlay } from "./ScoringOverlay";
