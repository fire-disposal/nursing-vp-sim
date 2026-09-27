import { act, fireEvent, render, screen } from "@/__tests__/render";
import { describe, expect, it, vi } from "vitest";
import NursingDiagnosisTool from "@/components/training/tools/NursingDiagnosisTool";
import { makeActivity } from "@/__tests__/fixtures/manifest";

/**
 * E6：保存回执只能来自服务端响应。
 *
 * 旧实现用 `setTimeout(() => setSaving(false), 800)` 把按钮文案从「保存到服务器」
 * 翻成「已保存」——无论服务端是否真的保存成功，也永远看不到失败原因。
 */

const activity = makeActivity("nursing_diagnosis", {
	label: "护理诊断",
	ui: { renderer: "nursing_diagnosis", placement: "side_panel", order: 10 },
});

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

/** 载入一条已有诊断 —— 只有列表非空时才会出现保存按钮。 */
function renderLoaded() {
	const bus = makeBus();
	render(<NursingDiagnosisTool activity={activity} recordId="1" bus={bus} />);
	act(() => {
		bus.fireResult({
			tool: "nursing_diagnosis",
			action: "load",
			ok: true,
			data: {
				diagnoses: [
					{ problem: "气体交换受损", related_factors: ["气道痉挛"], defining_characteristics: ["呼吸困难"], priority: 0 },
				],
				stems: ["气体交换受损"],
				factor_options: ["气道痉挛"],
				characteristic_options: ["呼吸困难"],
			},
		});
	});
	return bus;
}

describe("NursingDiagnosisTool 保存回执", () => {
	it("保存中不因定时器变成「已保存」：只有服务端 ok 才算保存成功", () => {
		vi.useFakeTimers();
		try {
			const bus = renderLoaded();
			fireEvent.click(screen.getByRole("button", { name: /保存到服务器/ }));

			expect(bus.invoked.filter((p) => p.action === "save")).toHaveLength(1);
			expect(screen.getByRole("button", { name: /保存中/ })).toBeDisabled();

			act(() => { vi.advanceTimersByTime(10_000); });

			expect(screen.queryByText("已保存")).toBeNull();
			expect(screen.getByRole("button", { name: /保存中/ })).toBeDisabled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("服务端返回 ok 才显示「已保存」", () => {
		const bus = renderLoaded();
		fireEvent.click(screen.getByRole("button", { name: /保存到服务器/ }));
		act(() => {
			bus.fireResult({ tool: "nursing_diagnosis", action: "save", ok: true, data: {} });
		});

		expect(screen.getByRole("button", { name: /已保存/ })).toBeInTheDocument();
	});

	it("服务端失败时显示失败状态与服务端原因，绝不显示「已保存」", () => {
		const bus = renderLoaded();
		fireEvent.click(screen.getByRole("button", { name: /保存到服务器/ }));
		act(() => {
			bus.fireResult({
				tool: "nursing_diagnosis",
				action: "save",
				ok: false,
				data: {},
				error: "本轮训练已结束，无法保存",
			});
		});

		expect(screen.getByText("本轮训练已结束，无法保存")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /保存失败，重试/ })).toBeInTheDocument();
		expect(screen.queryByText("已保存")).toBeNull();
	});

	it("保存成功后内容又变了 → 旧回执立即失效（不冒充当前草稿已保存）", () => {
		const bus = renderLoaded();
		fireEvent.click(screen.getByRole("button", { name: /保存到服务器/ }));
		act(() => {
			bus.fireResult({ tool: "nursing_diagnosis", action: "save", ok: true, data: {} });
		});
		expect(screen.getByText("已保存")).toBeInTheDocument();

		fireEvent.click(screen.getByLabelText("删除护理诊断"));

		expect(screen.queryByText("已保存")).toBeNull();
	});
});
