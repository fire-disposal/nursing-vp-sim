import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PatientHeaderFace from "./PatientHeaderFace";
import { useTrainingStore } from "@/stores/trainingStore";

afterEach(() => {
	cleanup();
	useTrainingStore.setState({ patient: null, emotion4D: "neutral" });
});

describe("PatientHeaderFace", () => {
	it("renders the live face avatar with emotion state", () => {
		useTrainingStore.setState({
			patient: { name: "王建国", age: 68, gender: "male", caseTitle: "T" },
			emotion4D: "irritated",
		});
		const { container, getByLabelText } = render(<PatientHeaderFace name="王建国" />);
		// 常驻 30px 活头像
		expect(container.querySelector('svg[width="30"]')).not.toBeNull();
		expect(getByLabelText("查看王建国的表情")).not.toBeNull();
		// 大脸未弹出
		expect(container.querySelector('svg[width="140"]')).toBeNull();
	});

	it("pops the big face on click and collapses back", async () => {
		const { container, getByLabelText } = render(<PatientHeaderFace name="王建国" />);
		fireEvent.click(getByLabelText("查看王建国的表情"));
		expect(container.querySelector('svg[width="140"]')).not.toBeNull();
		fireEvent.click(getByLabelText("折叠患者表情"));
		await waitFor(() => expect(container.querySelector('svg[width="140"]')).toBeNull());
	});

	it("renders without patient data (anonymized) without crash", () => {
		const { container } = render(<PatientHeaderFace name="患者" />);
		expect(container.querySelector('svg[width="30"]')).not.toBeNull();
	});
});
