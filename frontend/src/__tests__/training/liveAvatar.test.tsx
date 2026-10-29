import { describe, expect, it } from "vitest";
import { cleanup, render } from "@/__tests__/render";
import PatientPresenter from "@/components/training/presentation/PatientPresenter";
import { PRESENTATION_CHAIN } from "@/components/training/presentation/build";
import { buildLiveAvatarPayload } from "@/components/training/presentation/presenters/liveAvatar";
import { PRESENTERS } from "@/components/training/presentation/registry";
import type { EmotionSnapshot, PatientIdentity } from "@/components/training/presentation/types";
import { getEmotionBorder } from "@/stores/trainingStore";

/**
 * live 策略（M1，独立陈列台验证）：
 *   - build 必须是纯函数（同一输入同一负载、不改输入），选图与 realistic 共用一份规则；
 *   - 生产链不变（live 尚未接线）；
 *   - reducedMotion 必须整体退化为静态图；说话态/包络只影响运行时样式。
 */

const WANG: PatientIdentity = { name: "王建国", age: 68, gender: "male" };
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

describe("buildLiveAvatarPayload — 选图与表现参数", () => {
	it("写实病例 → 同一张写实立绘", () => {
		const p = buildLiveAvatarPayload(WANG, NEUTRAL);
		expect(p.kind).toBe("live");
		expect(p.src).toContain("case-chest-pain-elder-male");
		expect(p.alt).toBe("王建国");
	});

	it("情绪立绘命中 → 用该情绪的图（与 realistic 规则一致）", () => {
		const url = "https://cdn.example.com/wang-anxious.png";
		const p = buildLiveAvatarPayload({ ...WANG, portraitStates: { anxious: url } }, ANXIOUS);
		expect(p.src).toBe(url);
	});

	it("未绑定姓名 → 简洁画风兜底", () => {
		const p = buildLiveAvatarPayload(UNKNOWN, NEUTRAL);
		expect(p.src).not.toContain("realistic");
	});

	it("null 患者不崩溃，仍给兜底图", () => {
		const p = buildLiveAvatarPayload(null, NEUTRAL);
		expect(p.src).toBeTruthy();
		expect(p.alt).toBe("患者");
	});

	it("情绪配色来自 getEmotionBorder 单一映射", () => {
		expect(buildLiveAvatarPayload(WANG, ANXIOUS).accent).toBe(getEmotionBorder("anxious"));
	});

	it("焦虑的呼吸比回避更促、点头幅度更大", () => {
		const anxious = buildLiveAvatarPayload(WANG, ANXIOUS);
		const withdrawn = buildLiveAvatarPayload(WANG, { ...NEUTRAL, emotion: "withdrawn", emotion4D: "withdrawn" });
		expect(anxious.breathSeconds).toBeLessThan(withdrawn.breathSeconds);
		expect(anxious.nodScale).toBeGreaterThan(withdrawn.nodScale);
	});

	it("纯函数：不改输入，且同输入同输出", () => {
		const patientBefore = structuredClone(WANG);
		const emotionBefore = structuredClone(ANXIOUS);
		const a = buildLiveAvatarPayload(WANG, ANXIOUS);
		const b = buildLiveAvatarPayload(WANG, ANXIOUS);
		expect(a).toEqual(b);
		expect(WANG).toEqual(patientBefore);
		expect(ANXIOUS).toEqual(emotionBefore);
	});
});

describe("live 在注册表中的位置", () => {
	it("已注册，但不在生产策略链里（M3 才接线）", () => {
		expect(PRESENTERS.live.kind).toBe("live");
		expect(PRESENTATION_CHAIN).toEqual(["realistic", "static"]);
		expect(PRESENTATION_CHAIN).not.toContain("live");
	});
});

describe("live 渲染 — 运行时上下文与减弱动态", () => {
	const payload = buildLiveAvatarPayload(WANG, NEUTRAL);

	it("reducedMotion → 静态图（没有动效容器）", () => {
		const { container } = render(<PatientPresenter presentation={payload} fill reducedMotion />);
		expect(container.querySelector("[data-live-avatar]")).toBeNull();
		expect(container.querySelectorAll("img")).toHaveLength(1);
		cleanup();
	});

	it("默认（无说话态）→ 动效容器存在但不点头", () => {
		const { container } = render(<PatientPresenter presentation={payload} fill />);
		const root = container.querySelector("[data-live-avatar]");
		expect(root).not.toBeNull();
		expect(root?.getAttribute("data-speaking")).toBe("false");
		expect(container.querySelector(".patient-live-nod")).toBeNull();
		cleanup();
	});

	it("说话态 → 点头层出现，包络越大幅度越大", () => {
		const readNodScale = (envelope: number) => {
			const { container } = render(
				<PatientPresenter presentation={payload} fill speaking envelope={envelope} />,
			);
			const nod = container.querySelector(".patient-live-nod") as HTMLElement | null;
			const value = nod?.style.getPropertyValue("--nod-scale") ?? "";
			cleanup();
			return Number(value);
		};
		expect(readNodScale(0)).toBeGreaterThan(0);
		expect(readNodScale(1)).toBeGreaterThan(readNodScale(0));
		expect(readNodScale(5)).toBeLessThanOrEqual(payload.nodScale);
	});
});
