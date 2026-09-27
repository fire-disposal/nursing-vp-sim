import { act, render, screen } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import { makeManifest } from "@/__tests__/fixtures/manifest";
import { createMessageBus } from "@/engine/MessageBus";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { useTrainingStore } from "@/stores/trainingStore";

vi.mock("@/api/training", () => ({
	pauseTraining: vi.fn(),
	pauseTrainingOnHide: vi.fn(),
}));

import { pauseTraining } from "@/api/training";

const mockPause = vi.mocked(pauseTraining);

function makeSession() {
	const bus = createMessageBus();
	useTrainingStore.setState({
		bus,
		recordId: "1",
		messages: [],
		ttsAutoPlay: true,
		trainingEnded: false,
	});
	return bus;
}

function renderHeader(overrides: Parameters<typeof makeRecord>[0] = {}) {
	const record = makeRecord({
		mode: "guided",
		remaining_seconds: 600,
		manifest: { ...makeManifest() },
		...overrides,
	});
	const onLeave = vi.fn(async () => {});
	render(
		<MemoryRouter initialEntries={["/", "/training/1"]} initialIndex={1}>
			<Routes>
				<Route path="/" element={<div>训练选择页</div>} />
				<Route
					path="/training/:recordId"
					element={withTrainingData(
						<TrainingHeader toggleTts={vi.fn()} endTraining={vi.fn(async () => {})} leaveTraining={onLeave} />,
						record,
					)}
				/>
			</Routes>
		</MemoryRouter>,
	);
	return onLeave;
}

beforeEach(() => {
	mockPause.mockReset();
	mockPause.mockResolvedValue({ data: { message: "训练已暂停" } } as never);
});

afterEach(() => {
	useTrainingStore.getState().reset();
});

describe("TrainingHeader 连接与离开语义", () => {
	it("WS 断开说成「实时通知中断」，不说工具不可用（工具走 HTTP）", async () => {
		makeSession();
		renderHeader();
		await act(async () => {});

		const dot = screen.getByRole("status");
		const label = dot.getAttribute("aria-label") ?? "";
		expect(label).toContain("实时通知连接中断");
		// 关键：不得说成「工具不可用」——工具与对话都不经过 WS
		expect(label).not.toContain("工具不可用");
		expect(label).not.toContain("工具暂不可用");
		expect(label).toContain("对话与工具不受影响");
	});

	it("离开前先等服务端确认暂停，确认后才离开", async () => {
		makeSession();
		const onLeave = renderHeader();

		await userEvent.click(screen.getByLabelText("返回训练选择"));
		await userEvent.click(screen.getByRole("button", { name: "暂离，暂停计时" }));

		expect(onLeave).toHaveBeenCalledTimes(1);
		expect(mockPause).toHaveBeenCalledWith("1");
		expect(await screen.findByText("训练选择页")).toBeInTheDocument();
	});

	it("服务端未确认暂停 → 留在当前页，不宣称已暂停", async () => {
		makeSession();
		mockPause.mockRejectedValue(new Error("network down"));
		const onLeave = renderHeader();

		await userEvent.click(screen.getByLabelText("返回训练选择"));
		await userEvent.click(screen.getByRole("button", { name: "暂离，暂停计时" }));
		await act(async () => {});

		expect(onLeave).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("训练选择页")).toBeNull();
		expect(screen.getByRole("button", { name: "暂离，暂停计时" })).toBeInTheDocument();
	});

	it("独立考核离开不调用暂停（服务端本就连续计时）", async () => {
		makeSession();
		renderHeader({ mode: "assessment" });

		await userEvent.click(screen.getByLabelText("返回训练选择"));
		expect(screen.getByText(/连续计时/)).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "离开，计时继续" }));

		expect(mockPause).not.toHaveBeenCalled();
		expect(await screen.findByText("训练选择页")).toBeInTheDocument();
	});

	it("TTS 降级信号可见：标注降级供应商，不再静默换音色", () => {
		const bus = makeSession();
		renderHeader();

		act(() => {
			bus.emit("tts:degraded", { provider: "browser-speech-synthesis" });
		});

		expect(screen.getByText("语音降级")).toBeInTheDocument();
		expect(screen.getByLabelText(/已降级为「browser-speech-synthesis」朗读/)).toBeInTheDocument();

		// 服务端语音恢复（provider-status 上报了别的供应商）→ 降级标记消失
		act(() => {
			bus.emit("tts:provider-status", { provider: "volcengine-tts", latencyMs: 300 });
		});
		expect(screen.queryByText("语音降级")).toBeNull();
	});
});
