import { describe, expect, it } from "vitest";
import { buildPatientPresentation, PRESENTATION_CHAIN } from "./build";
import type { EmotionSnapshot, PatientIdentity } from "./types";

const WANG: PatientIdentity = { name: "王建国", age: 68, gender: "male" };
const ZHANG: PatientIdentity = { name: "张美华", age: 55, gender: "female" };
/** 没有照片、也没有情绪立绘的病例。 */
const NO_PHOTO: PatientIdentity = { name: "李明", age: 27, gender: "male" };

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

describe("buildPatientPresentation — 生产策略链 [realistic, mii]", () => {
	it("链顺序为 realistic → mii", () => {
		expect(PRESENTATION_CHAIN).toEqual(["realistic", "mii"]);
	});

	it("王建国 → 写实胸痛头像", () => {
		const p = buildPatientPresentation(WANG, NEUTRAL);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toContain("case-chest-pain-elder-male");
	});

	it("张美华 → 写实发热头像", () => {
		const p = buildPatientPresentation(ZHANG, NEUTRAL);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toContain("case-fever-middle-female");
	});

	it("无照片病例 → 程序化绘制（不加载任何图片）", () => {
		const p = buildPatientPresentation(NO_PHOTO, NEUTRAL);
		expect(p.kind).toBe("mii");
		if (p.kind === "mii") {
			expect(p.spec.hairStyle).toBe("short");
			expect(p.seed).toBeGreaterThanOrEqual(0);
		}
	});

	it("null 患者不崩溃且落到程序化绘制", () => {
		expect(buildPatientPresentation(null, NEUTRAL).kind).toBe("mii");
	});

	it("身份真的进长相：儿童头比中年人大", () => {
		const child = buildPatientPresentation({ name: null, age: 8, gender: "male" }, NEUTRAL);
		const adult = buildPatientPresentation({ name: null, age: 45, gender: "male" }, NEUTRAL);
		if (child.kind !== "mii" || adult.kind !== "mii") throw new Error("应走程序化绘制");
		expect(child.spec.head.rx).toBeGreaterThan(adult.spec.head.rx);
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
		const p = buildPatientPresentation({ ...NO_PHOTO, portraitStates: { anxious: ANXIOUS_URL } }, ANXIOUS);
		expect(p.kind).toBe("realistic");
		if (p.kind === "realistic") expect(p.src).toBe(ANXIOUS_URL);
	});

	it("该情绪无图且姓名未绑定 → 让位给程序化绘制", () => {
		const p = buildPatientPresentation({ ...NO_PHOTO, portraitStates: { anxious: ANXIOUS_URL } }, NEUTRAL);
		expect(p.kind).toBe("mii");
	});
});
