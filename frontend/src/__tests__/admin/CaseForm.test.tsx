import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaseFormModal from "@/components/admin/cases/CaseForm";

const mocks = vi.hoisted(() => ({
	generateCase: vi.fn(),
	getCaseDetail: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), apiError: vi.fn(), warning: vi.fn() },
	confirm: vi.fn(() => true),
}));

vi.mock("@/api", () => ({
	generateCase: mocks.generateCase,
	getCaseDetail: mocks.getCaseDetail,
	createCase: vi.fn(),
	updateCase: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({
	useToast: () => mocks.toast,
}));

vi.mock("@/components/ui/confirm", () => ({
	useConfirm: () => ({ confirm: mocks.confirm }),
}));

function renderModal(overrides?: { editingCase?: { id: number; name: string; training_type: string } | null }) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<CaseFormModal
				open={true}
				editingCase={overrides?.editingCase ?? null}
				startWithAiPanel={false}
				availableCases={[]}
				onClose={() => {}}
				onSaved={() => {}}
			/>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	mocks.generateCase.mockReset();
	mocks.getCaseDetail.mockReset();
	mocks.toast.success.mockClear();
	localStorage.clear();
});

describe("CaseForm AI 两步向导", () => {
	it("生成临床骨架：携带 stage=core 并填充表单", async () => {
		mocks.generateCase.mockResolvedValue({
			data: {
				case_data: {
					name: "肺炎患者",
					chief_complaint: "咳嗽伴发热3天",
					present_illness: "3天前受凉后咳嗽",
					patient_info: { name: "王大爷", age: 65, gender: "男" },
				},
			},
		});
		renderModal();

		await userEvent.click(screen.getByRole("button", { name: /AI/ }));
		await userEvent.type(screen.getByPlaceholderText(/描述你想生成的病例场景/), "老年男性，咳嗽发热3天");

		const coreBtn = screen.getByRole("button", { name: "生成临床骨架" });
		await userEvent.click(coreBtn);

		await waitFor(() => {
			expect(mocks.generateCase).toHaveBeenCalledTimes(1);
		});
		const payload = mocks.generateCase.mock.calls[0][0] as { stage: string };
		expect(payload.stage).toBe("core");

		// 生成结果填充表单 → 撤销按钮出现
		await waitFor(() => {
			expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringContaining("临床骨架"));
		});
		expect(screen.getByRole("button", { name: /撤销/ })).toBeTruthy();
	});

	it("生成教学细节：携带 stage=derivative 与当前病例上下文", async () => {
		mocks.generateCase.mockResolvedValue({
			data: {
				case_data: {
					hidden_info: ["吸烟30年"],
					required_inquiries: ["吸烟史"],
				},
			},
		});
		renderModal();

		await userEvent.click(screen.getByRole("button", { name: /AI/ }));
		await userEvent.type(screen.getByPlaceholderText(/描述你想生成的病例场景/), "老年肺炎");

		const detailBtn = screen.getByRole("button", { name: "生成教学细节" });
		await userEvent.click(detailBtn);

		await waitFor(() => {
			expect(mocks.generateCase).toHaveBeenCalledTimes(1);
		});
		const payload = mocks.generateCase.mock.calls[0][0] as { stage: string; current_case_data?: unknown };
		expect(payload.stage).toBe("derivative");
		expect(payload.current_case_data).toBeTruthy();
	});

	it("逐字段生成：携带 field=present_illness", async () => {
		mocks.generateCase.mockResolvedValue({
			data: { field_value: "3天前受凉后咳嗽加重，夜间为甚", field: "present_illness" },
		});
		renderModal();

		await userEvent.click(screen.getByRole("button", { name: /AI/ }));
		await userEvent.type(screen.getByPlaceholderText(/描述你想生成的病例场景/), "咳嗽病例");

		await userEvent.click(screen.getByRole("button", { name: "现病史" }));

		await waitFor(() => {
			expect(mocks.generateCase).toHaveBeenCalledTimes(1);
		});
		const payload = mocks.generateCase.mock.calls[0][0] as { field: string };
		expect(payload.field).toBe("present_illness");
		await waitFor(() => {
			expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringContaining("现病史"));
		});
	});

	it("描述为空时生成骨架给出提示", async () => {
		renderModal();
		await userEvent.click(screen.getByRole("button", { name: /AI/ }));

		await userEvent.click(screen.getByRole("button", { name: "生成临床骨架" }));

		await waitFor(() => {
			expect(screen.getByText("请输入病例描述")).toBeTruthy();
		});
		expect(mocks.generateCase).not.toHaveBeenCalled();
	});
});
