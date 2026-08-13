import { cleanup, fireEvent, render } from "@/__tests__/render";
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
		// 大脸铺满方框宽（aspect-square），不再渲染情绪换脸 SVG
		expect(container.querySelector('img[class*="aspect-square"]')).not.toBeNull();
		// 姓名作为身份标签存在（移动端条 + 桌面标签两处）
		expect(getAllByText(/王建国/).length).toBeGreaterThan(0);
	});

	it("collapses and expands the content on mobile toggle", () => {
		const { container, getByLabelText } = render(<PatientStage />);
		const content = container.querySelector("[data-patient-stage-content]");
		expect(content?.className).toContain("flex");
		fireEvent.click(getByLabelText("折叠患者区"));
		expect(content?.className).toContain("hidden");
		fireEvent.click(getByLabelText("展开患者区"));
		expect(content?.className).toContain("flex");
	});

	it("collapses to a slim rail and expands on desktop", () => {
		const { container, getByLabelText, queryByLabelText } = render(<PatientStage />);
		// 展开态：方框内容 + 收起控件
		expect(container.querySelector("[data-patient-stage-content]")).not.toBeNull();
		fireEvent.click(getByLabelText("收起患者区"));
		// 收起态：方框内容消失，出现展开把手
		expect(container.querySelector("[data-patient-stage-content]")).toBeNull();
		expect(queryByLabelText("展开患者区")).not.toBeNull();
		fireEvent.click(getByLabelText("展开患者区"));
		expect(container.querySelector("[data-patient-stage-content]")).not.toBeNull();
	});

	it("renders without patient data (anonymized) without crash", () => {
		const { container } = render(<PatientStage />);
		expect(container.querySelector('img[class*="aspect-square"]')).not.toBeNull();
	});
});
