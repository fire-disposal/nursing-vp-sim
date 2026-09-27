import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import { ConversationComposer } from "@/components/training/ConversationComposer";
import { createMessageBus } from "@/engine/MessageBus";

const toastMock = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("@/components/Toast", () => ({ useToast: () => toastMock }));

afterEach(() => {
	vi.unstubAllGlobals();
});

beforeEach(() => {
	toastMock.warning.mockClear();
});

function mockSpeechRecognition() {
	const rec = {
		lang: "",
		interimResults: false,
		continuous: false,
		start: vi.fn(),
		stop: vi.fn(),
		onresult: null as null | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void),
		onend: null as null | (() => void),
		onerror: null as null | ((e?: { error?: string }) => void),
	};
	vi.stubGlobal("webkitSpeechRecognition", function WebkitSR() { return rec; });
	return rec;
}

describe("ConversationComposer（双工语音对谈 + 文本输入）", () => {
	it("文本输入 Enter 提交走唯一 send 出口", () => {
		const onSend = vi.fn();
		render(<ConversationComposer onSend={onSend} />);
		const input = screen.getByLabelText("对话输入") as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "您哪里不舒服？" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onSend).toHaveBeenCalledWith("您哪里不舒服？");
		expect(input.value).toBe("");
	});

	it("空文本不提交", () => {
		const onSend = vi.fn();
		render(<ConversationComposer onSend={onSend} />);
		const input = screen.getByLabelText("对话输入") as HTMLTextAreaElement;
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onSend).not.toHaveBeenCalled();
	});

	it("患者回复中文本输入被禁用", () => {
		render(<ConversationComposer onSend={vi.fn()} loading />);
		expect(screen.getByLabelText("对话输入")).toBeDisabled();
	});

	it("双工：点一次麦克风即开启持续对谈（抬手不停），停顿后自动发送", async () => {
		const rec = mockSpeechRecognition();
		const onSend = vi.fn();
		render(<ConversationComposer onSend={onSend} />);
		const mic = screen.getByLabelText("持续对谈");
		expect(mic).toHaveAttribute("aria-pressed", "false");

		act(() => {
			fireEvent.pointerDown(mic);
		});
		await waitFor(() => expect(rec.start).toHaveBeenCalledTimes(1));
		// 常开识别：continuous + interimResults（否则没有端点检测与打断）
		expect(rec.continuous).toBe(true);
		expect(rec.interimResults).toBe(true);
		expect(mic).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByText("该你说话了")).toBeInTheDocument();

		// 抬手不停 —— 这就是"学生不必按住说话"
		fireEvent.pointerUp(mic);
		expect(onSend).not.toHaveBeenCalled();
		expect(rec.stop).not.toHaveBeenCalled();

		act(() => {
			rec.onresult?.({ results: [[{ transcript: "我这两天喘不上气" }]] });
		});
		expect(screen.getByText(/正在听你说/)).toBeInTheDocument();

		// 静音窗口判句尾 → 自动提交，不必松手
		await waitFor(() => expect(onSend).toHaveBeenCalledWith("我这两天喘不上气"), { timeout: 3000 });
	});

	it("三态显式呈现（听/想/说），打断给出可见反馈且打断文本仍进入发送链", async () => {
		const rec = mockSpeechRecognition();
		const bus = createMessageBus();
		const onSend = vi.fn();
		const onBargeIn = vi.fn();
		const { rerender } = render(
			<ConversationComposer onSend={onSend} bus={bus} onBargeIn={onBargeIn} loading />,
		);
		const mic = screen.getByLabelText("持续对谈");
		// 患者回复中也要能用麦克风，否则学生打断不了
		expect(mic).not.toBeDisabled();
		act(() => {
			fireEvent.pointerDown(mic);
		});

		// 三态常驻可见
		expect(screen.getByText("听")).toBeInTheDocument();
		expect(screen.getByText("想")).toBeInTheDocument();
		expect(screen.getByText("说")).toBeInTheDocument();

		// 患者在组织语言（回复中、还没出声）→ 想
		expect(screen.getByText(/患者在想/)).toBeInTheDocument();

		// 患者开始出声（既有 tts:start 事件）→ 听
		act(() => {
			bus.emit("tts:start", "你好");
		});
		expect(screen.getByText(/患者在说/)).toBeInTheDocument();

		// 学生开口 → 打断一次（停播 + 取消在途生成由装配层负责），并有可见反馈
		act(() => {
			rec.onresult?.({ results: [[{ transcript: "等一下" }]] });
		});
		expect(onBargeIn).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/已打断患者/)).toBeInTheDocument();
		// 打断会停播 → TTSManager 发 tts:end（患者出声结束）
		act(() => {
			bus.emit("tts:end", "");
		});

		// 同一句继续说：不重复打断；句尾仍把文本送进发送链
		act(() => {
			rec.onresult?.({ results: [[{ transcript: "等一下医生" }]] });
		});
		expect(onBargeIn).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(onSend).toHaveBeenCalledWith("等一下医生"), { timeout: 3000 });

		// 患者回复结束 → 说（该你说话了）
		rerender(<ConversationComposer onSend={onSend} bus={bus} onBargeIn={onBargeIn} />);
		expect(screen.getByText("该你说话了")).toBeInTheDocument();
	});

	it("听态：回复结束后 TTS 仍在播尾音（loading 已结束）→ 仍显示「听」而不是「该你说话了」", () => {
		const bus = createMessageBus();
		mockSpeechRecognition();
		render(<ConversationComposer onSend={vi.fn()} bus={bus} />);
		act(() => {
			fireEvent.pointerDown(screen.getByLabelText("持续对谈"));
		});

		act(() => {
			bus.emit("tts:start", "你好");
		});
		expect(screen.getByText(/患者在说/)).toBeInTheDocument();

		act(() => {
			bus.emit("tts:end", "");
		});
		expect(screen.getByText("该你说话了")).toBeInTheDocument();
	});

	it("持续对谈启动失败 → 明确提示并降级为按住说话（不静默）", async () => {
		const rec = mockSpeechRecognition();
		rec.start.mockImplementationOnce(() => {
			throw new Error("not-allowed");
		});
		const onSend = vi.fn();
		render(<ConversationComposer onSend={onSend} />);

		act(() => {
			fireEvent.pointerDown(screen.getByLabelText("持续对谈"));
		});
		await waitFor(() => expect(screen.getByText(/已改为按住说话/)).toBeInTheDocument());
		expect(screen.getByText(/已改为按住说话/)).toBeInTheDocument();

		// 降级后按钮语义变回按住说话，且这条路径仍然可用
		const mic = screen.getByLabelText("语音输入");
		fireEvent.pointerDown(mic);
		act(() => {
			rec.onresult?.({ results: [[{ transcript: "咳嗽三天" }]] });
		});
		fireEvent.pointerUp(mic);
		expect(onSend).toHaveBeenCalledWith("咳嗽三天");
	});

	it("浏览器不支持语音 → 麦克风灰色但可点，点击弹出简洁提示", async () => {
		render(<ConversationComposer onSend={vi.fn()} />);
		const micBtn = screen.getByLabelText("语音输入");
		// 灰色（非 HTML disabled），仍可点击以获取原因。
		expect(micBtn).not.toBeDisabled();
		fireEvent.pointerDown(micBtn);
		expect(toastMock.warning).toHaveBeenCalledWith(expect.stringContaining("不支持"));
	});
});
