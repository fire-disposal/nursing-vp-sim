import { cleanup, fireEvent, render, screen, waitFor } from "@/__tests__/render";
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

/**
 * 患者上下文：桌面常驻列（216px），大图**按需**以浮层查看；不再有折叠/展开两套状态。
 * 体征只显示学生自己测到过的（未测量前不预支答案）。
 */
describe("PatientStage（患者上下文）", () => {
	it("桌面列：常驻大图 + 姓名 + 年龄性别 + 情绪", () => {
		useTrainingStore.setState({ emotion4D: "irritated" });
		const { container } = renderStage(
			makeRecord({ patient_name: "王建国", patient_age: 68, patient_gender: "男", chief_complaint: "喘不上气" }),
		);
		const stage = container.querySelector("[data-patient-stage]") as HTMLElement;

		expect(stage.getAttribute("data-patient-mode")).toBe("full");
		const faceImg = Array.from(stage.querySelectorAll("img")).find((img) => (img as HTMLImageElement).style.width === "100%");
		expect(faceImg).toBeDefined();
		expect(stage).toHaveTextContent("王建国");
		expect(stage).toHaveTextContent("主诉");
		expect(stage).toHaveTextContent("喘不上气");
		expect(stage).toHaveTextContent("68");
	});

	it("点头像打开大图浮层，关闭后回到列（不是折叠）", async () => {
		const { container } = renderStage(makeRecord({ patient_name: "王建国", chief_complaint: "喘不上气" }));

		expect(screen.queryByRole("dialog")).toBeNull();
		fireEvent.click(container.querySelector("[data-patient-stage-head]") as HTMLElement);
		await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
		expect(screen.getByRole("dialog")).toHaveTextContent("主诉：喘不上气");

		// 列本身仍在（没有"收起"状态）
		expect(container.querySelector("[data-patient-stage]")).not.toBeNull();
	});

	it("只显示已测到的体征；没测过就不出现", () => {
		const { container, unmount } = renderStage(makeRecord({ patient_name: "王建国" }));
		expect(screen.queryByText("已测体征")).toBeNull();
		unmount();

		renderStage(
			makeRecord({
				patient_name: "王建国",
				exam_results: [
					{ type: "hr", label: "心率", value: "94", unit: "次/分", status: "normal", interpretation: "" },
				],
			}),
		);
		expect(screen.getByText("已测体征")).toBeInTheDocument();
		expect(screen.getByText(/94/)).toBeInTheDocument();
		expect(container).toBeDefined();
	});

	it("没有患者数据（匿名）也能渲染，不崩", () => {
		const { container } = renderStage(null);
		expect(container.querySelector("[data-patient-stage]")).not.toBeNull();
	});
});
