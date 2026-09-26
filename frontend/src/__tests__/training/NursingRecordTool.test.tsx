import { act, render, screen } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NursingRecordTool from "@/components/training/tools/NursingRecordTool";
import { makeActivity } from "@/__tests__/fixtures/manifest";
import { useTrainingStore } from "@/stores/trainingStore";

/** 面板只认 manifest 下发的 activity 定义（命令命名空间 = activity.id） */
const activity = makeActivity("nursing_record", { artifact_kind: "nursing_record", ui: { renderer: "nursing_record", placement: "side_panel", order: 10 } });

type Handler = (payload: Record<string, unknown>) => void;

function makeBus() {
	const handlers = new Map<string, Set<Handler>>();
	const invoked: Array<Record<string, unknown>> = [];
	return {
		invoked,
		emit(event: string, payload?: unknown) {
			if (event === "tool:invoke") invoked.push(payload as Record<string, unknown>);
			handlers.get(event)?.forEach((h) => { h(payload as Record<string, unknown>); });
		},
		on(event: string, h: Handler) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)!.add(h);
			return () => { handlers.get(event)?.delete(h); };
		},
		off(event: string, h: Handler) { handlers.get(event)?.delete(h); },
		listEvents() { return [...handlers.keys()]; },
		fireResult(payload: Record<string, unknown>) {
			handlers.get("tool:result")?.forEach((h) => { h(payload); });
		},
	};
}

describe("NursingRecordTool", () => {
	beforeEach(() => {
		// 全局 zustand store：跨用例必须复位，否则提交态会串场
		useTrainingStore.getState().reset();
	});

	it("mount 时发出 load 请求", () => {
		const bus = makeBus();
		render(<NursingRecordTool activity={activity} recordId="1" bus={bus} />);
		expect(bus.invoked.some((p) => p.action === "load")).toBe(true);
	});

	it("load ok=false 时显示错误与重试", async () => {
		const bus = makeBus();
		render(<NursingRecordTool activity={activity} recordId="1" bus={bus} />);
		act(() => {
			bus.fireResult({ tool: "nursing_record", action: "load", ok: false, data: {}, error: "本次训练未启用护理评估记录" });
		});
		expect(await screen.findByText("本次训练未启用护理评估记录")).toBeTruthy();
		const before = bus.invoked.filter((p) => p.action === "load").length;
		await userEvent.click(screen.getByText("重试"));
		expect(bus.invoked.filter((p) => p.action === "load").length).toBe(before + 1);
	});

	describe("提交生命周期", () => {
		function renderLoaded() {
			const bus = makeBus();
			render(<NursingRecordTool activity={activity} recordId="1" bus={bus} />);
			act(() => {
				bus.fireResult({
					tool: "nursing_record",
					action: "load",
					ok: true,
					data: {
						sheet_data: { subjective: "", objective: "", assessment: "", plan: "", evaluation: "" },
						status: "draft",
						submitted_at: null,
					},
				});
			});
			return bus;
		}

		it("内容为空时提交按钮不可用（零评估不能提交）", () => {
			renderLoaded();
			expect(screen.getByRole("button", { name: /提交评估/ })).toBeDisabled();
		});

		it("填写后提交走确认弹窗，并携带最后一次输入", async () => {
			const bus = renderLoaded();
			act(() => {
				useTrainingStore.getState().updateNursingRecordField("subjective", "头晕三天");
			});

			const button = screen.getByRole("button", { name: /提交评估/ });
			expect(button).toBeEnabled();
			await userEvent.click(button);
			await userEvent.click(screen.getByRole("button", { name: "确认提交" }));

			const submits = bus.invoked.filter((p) => p.action === "submit");
			expect(submits).toHaveLength(1);
			const params = submits[0].params as { sheet_data: Record<string, string> };
			expect(params.sheet_data.subjective).toBe("头晕三天");
		});

		it("提交成功后进入只读态（冻结 + 重新编辑入口）", async () => {
			const bus = renderLoaded();
			const frozen = { subjective: "头晕三天", objective: "", assessment: "", plan: "", evaluation: "" };
			act(() => {
				useTrainingStore.getState().updateNursingRecordField("subjective", "头晕三天");
			});
			await userEvent.click(screen.getByRole("button", { name: /提交评估/ }));
			await userEvent.click(screen.getByRole("button", { name: "确认提交" }));

			act(() => {
				bus.fireResult({
					tool: "nursing_record",
					action: "submit",
					ok: true,
					data: { sheet_data: frozen, status: "submitted", submitted_at: "2026-09-25T02:00:00+00:00" },
				});
			});

			expect(await screen.findByText("护理评估已提交")).toBeTruthy();
			expect(useTrainingStore.getState().nursingRecordSubmittedAt).toBe("2026-09-25T02:00:00+00:00");
			for (const box of screen.getAllByRole("textbox")) {
				expect(box).toHaveAttribute("readonly");
			}
			await userEvent.click(screen.getByRole("button", { name: /重新编辑/ }));
			expect(bus.invoked.filter((p) => p.action === "reopen")).toHaveLength(1);
		});

		it("提交被拒时展示服务端原因与缺失字段", async () => {
			const bus = renderLoaded();
			act(() => {
				useTrainingStore.getState().updateNursingRecordField("subjective", "头晕");
			});
			await userEvent.click(screen.getByRole("button", { name: /提交评估/ }));
			await userEvent.click(screen.getByRole("button", { name: "确认提交" }));

			act(() => {
				bus.fireResult({
					tool: "nursing_record",
					action: "submit",
					ok: false,
					data: { code: "nursing_record_submitted", missing_fields: ["assessment"] },
					error: "护理评估已提交，内容不可修改；如需修改请先重新编辑",
				});
			});

			expect(await screen.findByText(/护理评估已提交，内容不可修改/)).toBeTruthy();
			// 冲突 = 本地状态过期 → 回读服务端真值
			expect(bus.invoked.filter((p) => p.action === "load").length).toBeGreaterThan(1);
			expect(screen.getByRole("button", { name: /提交评估/ })).toBeEnabled();
		});

		it("草稿保存失败时给出错误并回读服务端状态", async () => {
			const bus = renderLoaded();
			act(() => {
				useTrainingStore.getState().updateNursingRecordField("subjective", "头晕");
			});
			await userEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
			expect(bus.invoked.filter((p) => p.action === "save")).toHaveLength(1);

			act(() => {
				bus.fireResult({
					tool: "nursing_record",
					action: "save",
					ok: false,
					data: { code: "nursing_record_submitted" },
					error: "护理评估已提交，内容不可修改；如需修改请先重新编辑",
				});
			});

			expect(await screen.findByText(/护理评估已提交，内容不可修改/)).toBeTruthy();
			expect(bus.invoked.filter((p) => p.action === "load").length).toBeGreaterThan(1);
		});
	});

	describe("超时处理", () => {
		beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); });
		afterEach(() => { vi.useRealTimers(); });

		it.skip("8 秒无响应时显示超时错误", async () => {
			const bus = makeBus();
			render(<NursingRecordTool activity={activity} recordId="1" bus={bus} />);
			await act(async () => { vi.advanceTimersByTime(8000); });
			expect(screen.getByText(/加载超时/)).toBeTruthy();
		});
	});
});
