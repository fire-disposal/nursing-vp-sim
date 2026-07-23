import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NursingRecordTool from "@/components/training/tools/NursingRecordTool";

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
	it("mount 时发出 load 请求", () => {
		const bus = makeBus();
		render(<NursingRecordTool recordId="1" bus={bus} recordDetail={null} />);
		expect(bus.invoked.some((p) => p.action === "load")).toBe(true);
	});

	it("load ok=false 时显示错误与重试", async () => {
		const bus = makeBus();
		render(<NursingRecordTool recordId="1" bus={bus} recordDetail={null} />);
		act(() => {
			bus.fireResult({ tool: "nursing_record", action: "load", ok: false, data: {}, error: "本次训练未启用护理评估记录" });
		});
		expect(await screen.findByText("本次训练未启用护理评估记录")).toBeTruthy();
		const before = bus.invoked.filter((p) => p.action === "load").length;
		await userEvent.click(screen.getByText("重试"));
		expect(bus.invoked.filter((p) => p.action === "load").length).toBe(before + 1);
	});

	describe("超时处理", () => {
		beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); });
		afterEach(() => { vi.useRealTimers(); });

		it.skip("8 秒无响应时显示超时错误", async () => {
			const bus = makeBus();
			render(<NursingRecordTool recordId="1" bus={bus} recordDetail={null} />);
			await act(async () => { vi.advanceTimersByTime(8000); });
			expect(screen.getByText(/加载超时/)).toBeTruthy();
		});
	});
});
