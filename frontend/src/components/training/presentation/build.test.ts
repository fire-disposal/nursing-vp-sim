import { describe, expect, it } from "vitest";
import { buildPatientPresentation, PRESENTATION_CHAIN } from "./build";
import { PRESENTERS } from "./registry";
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

describe("buildPatientPresentation — 默认策略链 [video, realistic, static]", () => {
	it("链上包含 video 预留策略且无源时让位", () => {
		expect(PRESENTATION_CHAIN).toEqual(["video", "realistic", "static"]);
		// video 无源 → null，链落到 realistic
		expect(PRESENTERS.video.build(WANG, NEUTRAL)).toBeNull();
		const p = buildPatientPresentation(WANG, NEUTRAL);
		expect(p.kind).toBe("realistic");
	});

	it("王建国 → 写实胸痛头像", () => {
		const p = buildPatientPresentation(WANG, NEUTRAL);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toContain("case-chest-pain-elder-male");
	});

	it("张美华 → 写实发热头像", () => {
		const p = buildPatientPresentation(ZHANG, NEUTRAL);
		if (p.kind === "realistic") expect(p.src).toContain("case-fever-middle-female");
	});

	it("未绑定病例 → 简洁画风兜底", () => {
		const p = buildPatientPresentation(UNKNOWN, NEUTRAL);
		expect(p.kind).toBe("static");
		if (p.kind === "static") expect(p.src).not.toContain("realistic");
	});

	it("null 患者不崩溃且落到 static", () => {
		expect(buildPatientPresentation(null, NEUTRAL).kind).toBe("static");
	});
});

describe("buildPatientPresentation — 指定策略链", () => {
	it('["svg"]: 4D 情绪数据派生 FaceConfig', () => {
		const p = buildPatientPresentation(WANG, IRRITATED, ["svg"]);
		expect(p.kind).toBe("svg");
		if (p.kind === "svg") {
			expect(p.cfg.browAngle).toBeLessThan(0); // 烦躁 → 眉毛下压
			expect(p.appearance.gender).toBe("male");
			expect(p.appearance.ageGroup).toBe("elderly");
		}
	});

	it('["png-variant"]: 情绪映射到变体 PNG', () => {
		const p = buildPatientPresentation(WANG, { ...NEUTRAL, emotion: "withdrawn" }, ["png-variant"]);
		expect(p.kind).toBe("png-variant");
		if (p.kind === "png-variant") expect(p.src).toMatch(/-s\.png/);
	});

	it("非法链（无 static）防御性兜底到简洁画风", () => {
		const p = buildPatientPresentation(UNKNOWN, NEUTRAL, ["video"]);
		expect(p.kind).toBe("static");
	});
});
