import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PatientFacePanel from "./PatientFacePanel";
import { useTrainingStore } from "@/stores/trainingStore";

afterEach(() => {
	cleanup();
	useTrainingStore.setState({ patient: null, emotion4D: "neutral" });
});

describe("PatientFacePanel", () => {
	it("shows only the expand button when closed", () => {
		const { container, getByLabelText } = render(<PatientFacePanel />);
		expect(getByLabelText("展开患者表情")).not.toBeNull();
		// 抽屉未渲染（无 150px 大脸）
		expect(container.querySelector('svg[width="150"]')).toBeNull();
	});

	it("pops out the drawer from the left on click and collapses back", async () => {
		useTrainingStore.setState({
			patient: { name: "李奶奶", age: 70, gender: "female", caseTitle: "T" },
			emotion4D: "irritated",
		});
		const { container, getByLabelText } = render(<PatientFacePanel />);
		fireEvent.click(getByLabelText("展开患者表情"));
		expect(container.querySelector('svg[width="150"]')).not.toBeNull();
		fireEvent.click(getByLabelText("折叠患者表情"));
		// 等待退出动画完成（AnimatePresence 保留 DOM 约 200ms）
		await waitFor(() => expect(container.querySelector('svg[width="150"]')).toBeNull());
		expect(getByLabelText("展开患者表情")).not.toBeNull();
	});

	it("renders without patient data (anonymized) without crash", () => {
		const { container, getByLabelText } = render(<PatientFacePanel />);
		fireEvent.click(getByLabelText("展开患者表情"));
		expect(container.querySelector('svg[width="150"]')).not.toBeNull();
	});
});
