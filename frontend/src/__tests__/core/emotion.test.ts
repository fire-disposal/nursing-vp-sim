import { describe, expect, it } from "vitest";
import {
	EMOTION_LABELS,
	getEmotionBorder,
	getEmotionColor,
} from "@/stores/trainingStore";

describe("EmotionState", () => {
	it("has 6 labels", () => {
		expect(Object.keys(EMOTION_LABELS)).toHaveLength(6);
	});

	it("includes anxious", () => {
		expect(EMOTION_LABELS.anxious).toBe("焦虑不安");
	});

	it("getEmotionBorder returns CSS var for valid state", () => {
		expect(getEmotionBorder("anxious")).toContain("--mantine-color-violet-4");
		expect(getEmotionBorder("neutral")).toContain("--mantine-color-gray-4");
	});

	it("getEmotionColor returns CSS var for valid state", () => {
		expect(getEmotionColor("anxious")).toContain("--mantine-color-violet-6");
		expect(getEmotionColor("neutral")).toContain("--mantine-color-dimmed");
	});
});
