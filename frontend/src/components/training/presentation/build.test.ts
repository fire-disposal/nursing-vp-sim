import { describe, expect, it } from "vitest";
import { buildPatientPresentation } from "./build";
import type { EmotionSnapshot, PatientIdentity } from "./types";

const WANG: PatientIdentity = { name: "王建国", age: 68, gender: "male" };
const ZHANG: PatientIdentity = { name: "张美华", age: 55, gender: "female" };
const UNKNOWN: PatientIdentity = { name: "李明", age: 27, gender: "male" };

const NEUTRAL: EmotionSnapshot = {
	emotion: "neutral",
	emotion4D: "neutral",
	values: { trust: 50, anxiety: 30, irritation: 20, cooperation: 70 },
};

const IRRITATED: EmotionSnapshot = {
	emotion: "defensive",
	emotion4D: "irritated",
	values: { trust: 20, anxiety: 10, irritation: 90, cooperation: 30 },
};

describe("buildPatientPresentation", () => {
	it("image mode: 王建国 returns the realistic chest-pain png", () => {
		const p = buildPatientPresentation(WANG, NEUTRAL, "image");
		expect(p.kind).toBe("image");
		if (p.kind === "image") expect(p.src).toContain("case-chest-pain-elder-male");
	});

	it("image mode: 张美华 returns the realistic fever png", () => {
		const p = buildPatientPresentation(ZHANG, NEUTRAL, "image");
		if (p.kind === "image") expect(p.src).toContain("case-fever-middle-female");
	});

	it("image mode: unbound patient falls back to default avatar", () => {
		const p = buildPatientPresentation(UNKNOWN, NEUTRAL, "image");
		if (p.kind === "image") expect(p.src).not.toContain("realistic");
	});

	it("image mode: null patient does not crash", () => {
		const p = buildPatientPresentation(null, NEUTRAL, "image");
		expect(p.kind).toBe("image");
	});

	it("svg mode: derives face config from 4D emotion data", () => {
		const p = buildPatientPresentation(WANG, IRRITATED, "svg");
		expect(p.kind).toBe("svg");
		if (p.kind === "svg") {
			// 烦躁：眉毛下压（browAngle 为负）
			expect(p.cfg.browAngle).toBeLessThan(0);
			expect(p.appearance.gender).toBe("male");
			expect(p.appearance.ageGroup).toBe("elderly");
		}
	});

	it("png-variant mode: maps emotion to a variant png", () => {
		const p = buildPatientPresentation(WANG, { ...NEUTRAL, emotion: "withdrawn" }, "png-variant");
		expect(p.kind).toBe("png-variant");
		if (p.kind === "png-variant") expect(p.src).toMatch(/-s\.png/);
	});

	it("default mode equals current production mode (image)", () => {
		expect(buildPatientPresentation(WANG, NEUTRAL).kind).toBe("image");
	});
});
