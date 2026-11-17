import { describe, expect, it } from "vitest";
import { expressionFor } from "@/components/training/presentation/engine/character";
import { closedMouthCurve } from "@/components/training/presentation/engine/mii";

const CY = 0.5;

describe("闭口嘴曲线", () => {
	it("上扬时嘴角高于中心", () => {
		const { cornerY, controlY } = closedMouthCurve(0.5, CY);
		expect(cornerY).toBeLessThan(CY);
		expect(controlY).toBeGreaterThan(CY);
	});

	it("下撇时嘴角低于中心", () => {
		const { cornerY, controlY } = closedMouthCurve(-0.5, CY);
		expect(cornerY).toBeGreaterThan(CY);
		expect(controlY).toBeLessThan(CY);
	});

	it("烦躁/抵触必须画成下撇嘴，而不是中性或上扬", () => {
		const { cornerY, controlY } = closedMouthCurve(expressionFor("defensive").smile, CY);
		expect(expressionFor("defensive").smile).toBeLessThan(0);
		expect(cornerY).toBeGreaterThan(CY);
		expect(controlY).toBeLessThan(CY);
	});

	it("中性嘴保持水平，超出范围按 -1..1 夹紧", () => {
		expect(closedMouthCurve(0, CY)).toEqual({ cornerY: CY, controlY: CY });
		expect(closedMouthCurve(-3, CY)).toEqual(closedMouthCurve(-1, CY));
		expect(closedMouthCurve(3, CY)).toEqual(closedMouthCurve(1, CY));
	});
});
