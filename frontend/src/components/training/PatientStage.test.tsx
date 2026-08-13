import { cleanup, fireEvent, render, waitFor } from "@/__tests__/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PatientStage from "./PatientStage";
import { useTrainingStore } from "@/stores/trainingStore";

const mockBus = { on: vi.fn(() => () => {}), emit: vi.fn(), off: vi.fn() } as never;

beforeEach(() => {
	useTrainingStore.setState({ bus: mockBus, recordId: "1", capabilities: {} });
});

afterEach(() => {
	cleanup();
	useTrainingStore.setState({ patient: null, emotion4D: "neutral" });
});

describe("PatientStage", () => {
	it("renders the big face, name, and emotion", () => {
		useTrainingStore.setState({
			patient: { name: "王建国", age: 68, gender: "male", caseTitle: "慢阻肺", chiefComplaint: "喘不上气" },
			emotion4D: "irritated",
		});
		const { container, getAllByText } = render(<PatientStage />);
		const faceImg = Array.from(container.querySelectorAll("img")).find((img) => (img as HTMLImageElement).style.width === "100%");
		expect(faceImg).toBeDefined();
		expect(getAllByText(/王建国/).length).toBeGreaterThan(0);
	});

	it("collapses and expands the content on mobile toggle", () => {
		const { container, getByLabelText } = render(<PatientStage />);
		const content = container.querySelector("[data-patient-stage-content]") as HTMLElement;
		expect(content.style.display).toBe("flex");
		fireEvent.click(getByLabelText("折叠患者区"));
		expect(content.style.display).toBe("none");
		fireEvent.click(getByLabelText("展开患者区"));
		expect(content.style.display).toBe("flex");
	});

	it("collapses to a slim rail and expands on desktop", async () => {
		const { container, getByLabelText, queryByLabelText } = render(<PatientStage />);
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
		const { container } = render(<PatientStage />);
		const faceImg = Array.from(container.querySelectorAll("img")).find((img) => (img as HTMLImageElement).style.width === "100%");
		expect(faceImg).toBeDefined();
	});
});
