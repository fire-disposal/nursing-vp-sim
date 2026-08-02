import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PatientInfoTool from "./PatientInfoTool";
import { useTrainingStore } from "@/stores/trainingStore";

const bus = { on: vi.fn(), emit: vi.fn(), off: vi.fn() } as never;

afterEach(() => {
	cleanup();
	useTrainingStore.setState({ patient: null, emotion4D: "neutral" });
});

describe("PatientInfoTool", () => {
	it("renders the patient face alongside identity info", () => {
		useTrainingStore.setState({
			patient: { name: "张三", age: 70, gender: "female", caseTitle: "T" },
		});
		const { container, getByText } = render(
			<PatientInfoTool bus={bus} recordId="1" recordDetail={{ patient_name: "张三" } as never} />,
		);
		// 高级脸已替换 User 图标
		expect(container.querySelector('svg[aria-label="患者表情"]')).not.toBeNull();
		expect(getByText("张三")).not.toBeNull();
	});

	it("handles anonymized patients (age 0) without crash", () => {
		useTrainingStore.setState({ patient: null });
		const { container } = render(
			<PatientInfoTool bus={bus} recordId="1" recordDetail={{ patient_age: 0, patient_gender: "" } as never} />,
		);
		expect(container.querySelector('svg[aria-label="患者表情"]')).not.toBeNull();
	});
});
