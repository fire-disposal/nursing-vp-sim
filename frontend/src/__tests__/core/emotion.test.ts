import { describe, expect, it } from "vitest";
import {
	EMOTION_LABELS,
	getEmotionBorder,
	getEmotionColor,
} from "@/engine/PluginContext";

describe("EmotionState", () => {
	it("has 6 labels", () => {
		expect(Object.keys(EMOTION_LABELS)).toHaveLength(6);
	});

	it("includes anxious", () => {
		expect(EMOTION_LABELS.anxious).toBe("焦虑不安");
	});

	it("getEmotionBorder returns class for valid state", () => {
		expect(getEmotionBorder("anxious")).toContain("border-purple");
		expect(getEmotionBorder("neutral")).toContain("border-border");
	});

	it("getEmotionColor returns class for valid state", () => {
		expect(getEmotionColor("anxious")).toContain("text-purple");
		expect(getEmotionColor("neutral")).toContain("text-muted");
	});
});
