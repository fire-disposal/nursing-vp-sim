import { cleanup, render } from "@/__tests__/render";
import { afterEach, describe, expect, it } from "vitest";
import { useTrainingStore } from "@/stores/trainingStore";
import PatientFace from "./PatientFace";

afterEach(() => {
	cleanup();
	useTrainingStore.setState({
		emotion4D: "neutral",
		trust: 50,
		anxiety: 30,
		irritation: 20,
		cooperation: 60,
	});
});

describe("PatientFace", () => {
	it("renders an svg face with default neutral state", () => {
		const { container } = render(<PatientFace size={40} />);
		const svg = container.querySelector("svg");
		expect(svg).not.toBeNull();
		expect(svg).toHaveAttribute("aria-label", "患者表情");
	});

	it("reacts to store emotion changes", () => {
		useTrainingStore.setState({
			emotion4D: "irritated",
			trust: 20,
			anxiety: 10,
			irritation: 90,
			cooperation: 20,
		});
		const { container } = render(<PatientFace size={40} />);
		// 烦躁态：眉毛下压 → 左眉内端 y 大于外端
		const brow = container.querySelectorAll("path")[0];
		const d = brow?.getAttribute("d") ?? "";
		// d 形如 "M 30 34.4 Q 36 28 44 42.4" — 内端(44) 低于外端(30)
		const innerY = Number(d.split("44 ")[1]?.split(" ")[0]);
		const outerY = Number(d.split("M 30 ")[1]?.split(" ")[0]);
		expect(innerY).toBeGreaterThan(outerY);
	});

	it("renders tears for withdrawn state", () => {
		useTrainingStore.setState({
			emotion4D: "withdrawn",
			trust: 10,
			anxiety: 60,
			irritation: 20,
			cooperation: 20,
		});
		const { container } = render(<PatientFace size={40} />);
		// 眼泪用 TEAR 色填充的圆 — 检查填充色出现
		expect(container.querySelectorAll('circle[fill="#7ec8f2"]').length).toBe(2);
	});
});
