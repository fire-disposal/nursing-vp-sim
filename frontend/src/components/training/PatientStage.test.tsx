import { cleanup, fireEvent, render, waitFor } from "@/__tests__/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import PatientStage from "./PatientStage";
import type { TrainingRecordDetail } from "@/engine/training-record-types";
import { useTrainingStore } from "@/stores/trainingStore";

const mockBus = { on: vi.fn(() => () => {}), emit: vi.fn(), off: vi.fn() } as never;

/** 患者事实来自原始 record（不再经 store 复制）。 */
function renderStage(record: TrainingRecordDetail | null) {
	return render(withTrainingData(<PatientStage />, record));
}

beforeEach(() => {
	useTrainingStore.setState({ bus: mockBus, recordId: "1" });
});

afterEach(() => {
	cleanup();
	useTrainingStore.setState({ emotion4D: "neutral" });
});

describe("PatientStage", () => {
	it("renders the big face, name, and emotion", () => {
		useTrainingStore.setState({ emotion4D: "irritated" });
		const { container, getAllByText } = renderStage(
			makeRecord({ patient_name: "王建国", patient_age: 68, patient_gender: "男", chief_complaint: "喘不上气" }),
		);
		const faceImg = Array.from(container.querySelectorAll("img")).find((img) => (img as HTMLImageElement).style.width === "100%");
		expect(faceImg).toBeDefined();
		expect(getAllByText(/王建国/).length).toBeGreaterThan(0);
	});

	it("collapses and expands the content on mobile toggle", () => {
		const { container, getByLabelText } = renderStage(makeRecord());
		const content = container.querySelector("[data-patient-stage-content]") as HTMLElement;
		expect(content.style.display).toBe("flex");
		fireEvent.click(getByLabelText("折叠患者区"));
		expect(content.style.display).toBe("none");
		fireEvent.click(getByLabelText("展开患者区"));
		expect(content.style.display).toBe("flex");
	});

	it("collapses to a slim rail and expands on desktop", async () => {
		const { container, getByLabelText, queryByLabelText } = renderStage(makeRecord());
		expect(container.querySelector("[data-patient-stage-content]")).not.toBeNull();
		fireEvent.click(getByLabelText("收起患者区"));
		await waitFor(() => {
			expect(container.querySelector("[data-patient-stage-content]")).toBeNull();
		});
		expect(queryByLabelText("展开患者区")).not.toBeNull();
		fireEvent.click(getByLabelText("展开患者区"));
		await waitFor(() => {
			expect(container.querySelector("[data-patient-stage-content]")).not.toBeNull();
		});
	});

	it("renders without patient data (anonymized) without crash", () => {
		const { container } = renderStage(null);
		const faceImg = Array.from(container.querySelectorAll("img")).find((img) => (img as HTMLImageElement).style.width === "100%");
		expect(faceImg).toBeDefined();
	});
});
