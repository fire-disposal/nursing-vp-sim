import { cleanup, fireEvent, render } from "@testing-library/react";
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
	it("renders the big face, emotion, and patient info", () => {
		useTrainingStore.setState({
			patient: { name: "王建国", age: 68, gender: "male", caseTitle: "慢阻肺", chiefComplaint: "喘不上气" },
			emotion4D: "irritated",
		});
		const { container, getAllByText } = render(<PatientStage />);
		// 大脸 200px（表现层静态头像，不再渲染情绪换脸 SVG）
		expect(container.querySelector('img[style*="200px"]')).not.toBeNull();
		// 姓名出现在折叠头与信息块（两处）
		expect(getAllByText("王建国").length).toBeGreaterThan(0);
		expect(getAllByText(/68岁/).length).toBeGreaterThan(0);
		expect(getAllByText(/主诉：喘不上气/).length).toBeGreaterThan(0);
	});

	it("collapses and expands the content on mobile toggle", () => {
		const { container, getByLabelText } = render(<PatientStage />);
		const content = container.querySelector("div.min-h-0");
		expect(content?.className).toContain("flex");
		fireEvent.click(getByLabelText("折叠患者区"));
		expect(content?.className).toContain("hidden");
		fireEvent.click(getByLabelText("展开患者区"));
		expect(content?.className).toContain("flex");
	});

	it("renders without patient data (anonymized) without crash", () => {
		const { container } = render(<PatientStage />);
		expect(container.querySelector('img[style*="200px"]')).not.toBeNull();
	});
});
