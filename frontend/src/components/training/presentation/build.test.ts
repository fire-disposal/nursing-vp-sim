import { describe, expect, it } from "vitest";
import { buildPatientPresentation, PRESENTATION_CHAIN } from "./build";
import type { EmotionSnapshot, PatientIdentity } from "./types";

const WANG: PatientIdentity = { name: "王建国", age: 68, gender: "male" };
const ZHANG: PatientIdentity = { name: "张美华", age: 55, gender: "female" };
const UNKNOWN: PatientIdentity = { name: "李明", age: 27, gender: "male" };

const NEUTRAL: EmotionSnapshot = {
	emotion: "neutral",
	emotion4D: "neutral",
	values: { trust: 50, anxiety: 30, irritation: 20, cooperation: 70 },
};

const ANXIOUS: EmotionSnapshot = {
	emotion: "anxious",
	emotion4D: "anxious_guarded",
	values: { trust: 30, anxiety: 85, irritation: 40, cooperation: 40 },
};

describe("buildPatientPresentation — 默认策略链 [realistic, static]", () => {
	it("生产链顺序为 realistic → static", () => {
		expect(PRESENTATION_CHAIN).toEqual(["realistic", "static"]);
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
	it("非法链（无 static）防御性兜底到简洁画风", () => {
		const p = buildPatientPresentation(UNKNOWN, NEUTRAL, ["realistic"]);
		expect(p.kind).toBe("static");
	});
});

describe("buildPatientPresentation — 情绪立绘（patient_info.portrait_states）", () => {
	const ANXIOUS_URL = "https://cdn.example.com/wang-anxious.png";
	const wangWithStates: PatientIdentity = {
		...WANG,
		portraitStates: { anxious: ANXIOUS_URL, open: "/media/cases/wang-open.png" },
	};

	it("命中当前情绪 → 用该情绪的立绘", () => {
		const p = buildPatientPresentation(wangWithStates, ANXIOUS);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toBe(ANXIOUS_URL);
	});

	it("未命中情绪 → 回落单张写实立绘", () => {
		const p = buildPatientPresentation(wangWithStates, NEUTRAL);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toContain("case-chest-pain-elder-male");
	});

	it("未声明情绪立绘 → 与过去完全一致（只按姓名取单张）", () => {
		const p = buildPatientPresentation(WANG, ANXIOUS);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toContain("case-chest-pain-elder-male");
	});

	it("未绑定姓名的病例，靠情绪立绘也能进写实层", () => {
		const p = buildPatientPresentation({ ...UNKNOWN, portraitStates: { anxious: ANXIOUS_URL } }, ANXIOUS);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toBe(ANXIOUS_URL);
	});

	it("该情绪无图且姓名未绑定 → 让位给简洁画风", () => {
		const p = buildPatientPresentation({ ...UNKNOWN, portraitStates: { anxious: ANXIOUS_URL } }, NEUTRAL);
		expect(p.kind).toBe("static");
	});
});
