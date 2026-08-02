import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PatientFacePanel from "./PatientFacePanel";
import { useTrainingStore } from "@/stores/trainingStore";

afterEach(() => {
	cleanup();
	useTrainingStore.setState({ patient: null, emotion4D: "neutral" });
});

describe("PatientFacePanel", () => {
	it("renders collapsed by default with a small face and emotion label", () => {
		useTrainingStore.setState({
			patient: { name: "李奶奶", age: 70, gender: "female", caseTitle: "T" },
			emotion4D: "withdrawn",
		});
		const { container, getByText } = render(<PatientFacePanel />);
		const svg = container.querySelector("svg[aria-label='患者表情']");
		expect(svg).not.toBeNull();
		expect(getByText(/患者表情/)).not.toBeNull();
		expect(getByText(/沉默回避/)).not.toBeNull();
		// 折叠态 = 36px 小脸
		expect(svg?.getAttribute("width")).toBe("36");
	});

	it("expands to a large face with 4D bars and collapses back", () => {
		const { container, getByLabelText, getByText } = render(<PatientFacePanel />);
		fireEvent.click(getByText(/患者表情/));
		const expanded = container.querySelector("svg[aria-label='患者表情']");
		expect(expanded?.getAttribute("width")).toBe("120");
		expect(getByText("信任")).not.toBeNull();
		expect(getByText("焦虑")).not.toBeNull();
		fireEvent.click(getByLabelText("折叠患者表情"));
		expect(container.querySelector("svg[aria-label='患者表情']")?.getAttribute("width")).toBe("36");
	});

	it("renders without patient data (anonymized) without crash", () => {
		const { container } = render(<PatientFacePanel />);
		expect(container.querySelector("svg[aria-label='患者表情']")).not.toBeNull();
	});
});
