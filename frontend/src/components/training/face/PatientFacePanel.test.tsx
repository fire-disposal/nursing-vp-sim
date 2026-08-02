import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PatientFacePanel from "./PatientFacePanel";
import { useTrainingStore } from "@/stores/trainingStore";

afterEach(() => {
	cleanup();
	useTrainingStore.setState({ patient: null, emotion4D: "neutral" });
});

describe("PatientFacePanel", () => {
	it("always shows the small face square", () => {
		const { container, getByLabelText } = render(<PatientFacePanel />);
		expect(getByLabelText("展开患者表情")).not.toBeNull();
		// 常驻 44px 小方块
		expect(container.querySelector('svg[width="44"]')).not.toBeNull();
		// 弹出未渲染（无 150px 大脸）
		expect(container.querySelector('svg[width="150"]')).toBeNull();
	});

	it("toggles the light popover with the big face", async () => {
		useTrainingStore.setState({
			patient: { name: "王建国", age: 68, gender: "male", caseTitle: "T" },
			emotion4D: "irritated",
		});
		const { container, getByLabelText } = render(<PatientFacePanel />);
		fireEvent.click(getByLabelText("展开患者表情"));
		expect(container.querySelector('svg[width="150"]')).not.toBeNull();
		// 小方块仍在（不遮挡、可再点收起）
		expect(container.querySelector('svg[width="44"]')).not.toBeNull();
		fireEvent.click(getByLabelText("折叠患者表情"));
		// 等待退出动画完成（AnimatePresence 保留 DOM 约 150ms）
		await waitFor(() => expect(container.querySelector('svg[width="150"]')).toBeNull());
	});

	it("renders without patient data (anonymized) without crash", () => {
		const { container, getByLabelText } = render(<PatientFacePanel />);
		fireEvent.click(getByLabelText("展开患者表情"));
		expect(container.querySelector('svg[width="150"]')).not.toBeNull();
	});
});
