import { act, render, screen } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import PhysicalExamTool from "@/components/training/tools/PhysicalExamTool";
import { makeActivity } from "@/__tests__/fixtures/manifest";

/** 面板只认 manifest 下发的 activity 定义（命令命名空间 = activity.id） */
const activity = makeActivity("physical_exam");

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

const HIGH_TEMP_RESULT = {
	tool: "physical_exam",
	action: "measure",
	ok: true,
	data: {
		op_type: "temp",
		result: {
			label: "体温",
			value: "39.0",
			unit: "°C",
			interpretation: { status: "high", text: "体温 39.0°C，高于参考范围（36.3-37.2°C）" },
		},
	},
};

const NORMAL_HR_RESULT = {
	tool: "physical_exam",
	action: "measure",
	ok: true,
	data: {
		op_type: "hr",
		result: {
			label: "心率",
			value: "76",
			unit: "次/分",
			interpretation: { status: "normal", text: "心率 76 次/分，在参考范围（60-100 次/分）内" },
		},
	},
};

afterEach(() => {
	vi.clearAllMocks();
});

describe("PhysicalExamTool 解读与异常汇总", () => {
	it("部位导航与检查动作可通过可访问按钮操作", async () => {
		const bus = makeBus();
		render(<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={null} />);

		expect(screen.getByRole("button", { name: "胸部" })).toHaveAttribute("aria-pressed", "true");
		await userEvent.click(screen.getByRole("button", { name: "检查心率" }));

		expect(bus.invoked).toContainEqual({
			tool: "physical_exam",
			action: "measure",
			params: { op_type: "hr" },
			recordId: 1,
		});
		expect(screen.getByRole("button", { name: "检查呼吸频率" })).toBeDisabled();
	});

	it("重新进入时恢复已采集结果与解读，考核模式隐藏解读", () => {
		const bus = makeBus();
		const exam_results = [
			{ type: "hr", value: "94.0", unit: "次/分", status: "normal" },
			{
				type: "temp",
				value: "39.0",
				unit: "°C",
				status: "high",
				interpretation: "体温 39.0°C，高于参考范围（36.3-37.2°C）",
			},
		];
		const { unmount } = render(
			<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={{ mode: "guided", exam_results } as never} />,
		);

		expect(screen.getByText("94.0")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "复查心率" })).toBeInTheDocument();
		expect(screen.getByText("体温 39.0°C，高于参考范围（36.3-37.2°C）")).toBeInTheDocument();
		unmount();

		render(
			<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={{ mode: "assessment", exam_results } as never} />,
		);

		expect(screen.getByText("异常发现")).toBeInTheDocument();
		expect(screen.queryByText("体温 39.0°C，高于参考范围（36.3-37.2°C）")).toBeNull();
	});
	it("高温测量：异常汇总 + 引导模式展示解读文案", () => {
		const bus = makeBus();
		render(<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={null} />);
		act(() => { bus.fireResult(HIGH_TEMP_RESULT); });

		expect(screen.getByText("异常发现")).toBeTruthy();
		expect(screen.getByText("偏高")).toBeTruthy();
		expect(screen.getByText("体温 39.0°C，高于参考范围（36.3-37.2°C）")).toBeTruthy();
	});

	it("考核模式（recordDetail.mode=assessment）隐藏解读文案但保留汇总", () => {
		const bus = makeBus();
		const recordDetail = { mode: "assessment" } as never;
		render(<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={recordDetail} />);
		act(() => { bus.fireResult(HIGH_TEMP_RESULT); });

		expect(screen.getByText("异常发现")).toBeTruthy();
		expect(screen.queryByText("体温 39.0°C，高于参考范围（36.3-37.2°C）")).toBeNull();
	});

	it("盲盒模式（recordDetail.mode=blind_box）同样隐藏解读但保留汇总", () => {
		const bus = makeBus();
		const recordDetail = { mode: "blind_box" } as never;
		render(<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={recordDetail} />);
		act(() => { bus.fireResult(HIGH_TEMP_RESULT); });

		expect(screen.getByText("异常发现")).toBeTruthy();
		expect(screen.queryByText("体温 39.0°C，高于参考范围（36.3-37.2°C）")).toBeNull();
	});

	it("正常测量：无异常汇总、无解读", () => {
		const bus = makeBus();
		render(<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={null} />);
		act(() => { bus.fireResult(NORMAL_HR_RESULT); });

		expect(screen.queryByText("异常发现")).toBeNull();
		expect(screen.queryByText("心率 76 次/分，在参考范围（60-100 次/分）内")).toBeNull();
	});

	it("测量值显示在结果条", () => {
		const bus = makeBus();
		render(<PhysicalExamTool activity={activity} recordId="1" bus={bus} recordDetail={null} />);
		act(() => { bus.fireResult(HIGH_TEMP_RESULT); });

		expect(screen.getByText("39.0")).toBeTruthy();
	});
});
