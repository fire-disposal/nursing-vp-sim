import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamDonePayload } from "@/api/sse";
import { StreamManager } from "@/engine/StreamManager";
import { useTrainingStore } from "@/stores/trainingStore";

vi.mock("@/api", () => ({
	sendMessageStream: vi.fn(),
	correctLastMessageStream: vi.fn(),
}));

import { sendMessageStream } from "@/api";

const mockStream = sendMessageStream as ReturnType<typeof vi.fn>;

type StreamCallbacks = {
	onChunk: (chunk: string) => void;
	onDone: (id?: number, payload?: StreamDonePayload) => void;
	onError: (err: string) => void;
	onEmotion: (c: { state: string; trust: number; comfort: number }) => void;
	onInitiativeState: (d: Record<string, unknown>) => void;
};

function captureCallbacks(): { signal: AbortSignal } & StreamCallbacks {
	const captured = {} as { signal: AbortSignal } & StreamCallbacks;
	mockStream.mockImplementation(
		async (
			_recordId,
			_content,
			onChunk,
			onDone,
			onError,
			signal,
			onEmotion,
			onInitiativeState,
		) => {
			Object.assign(captured, { onChunk, onDone, onError, signal, onEmotion, onInitiativeState });
		},
	);
	return captured;
}

function resetStore() {
	useTrainingStore.setState({
		messages: [],
		sending: false,
	});
}

beforeEach(() => {
	mockStream.mockReset();
	resetStore();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("StreamManager.send 主流程", () => {
	it("happy path: chunks append, done finalizes, sending resets", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const onPatientChunk = vi.fn();
		const onPatientDone = vi.fn();

		const promise = manager.send("我哪里不舒服？", { onPatientChunk, onPatientDone });
		expect(useTrainingStore.getState().sending).toBe(true);
		expect(useTrainingStore.getState().messages).toHaveLength(2);

		cb.onChunk("你");
		cb.onChunk("好");
		cb.onDone(42, { ended: true, end_reason: "patient_walkout" });
		await promise;

		const msgs = useTrainingStore.getState().messages;
		expect(msgs[1].content).toBe("你好");
		expect(msgs[1].streaming).toBe(false);
		expect(msgs[1].id).toBe("42");
		expect(useTrainingStore.getState().sending).toBe(false);
		expect(onPatientChunk).toHaveBeenCalledTimes(2);
		// done 负载必须原样转发：前端靠 end_reason 识别「患者中止访谈」并结束训练
		expect(onPatientDone).toHaveBeenCalledWith(42, { ended: true, end_reason: "patient_walkout" });
	});

	it("batches token writes into one animation frame while retaining every chunk", async () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		let onChunk: (chunk: string) => void;
		let onDone: (id?: number, payload?: StreamDonePayload) => void;
		let releaseStream: () => void;
		mockStream.mockImplementation(
			async (_recordId, _content, nextChunk, nextDone) => {
				onChunk = nextChunk;
				onDone = nextDone;
				await new Promise<void>((resolve) => {
					releaseStream = resolve;
				});
			},
		);

		const manager = new StreamManager(1);
		const promise = manager.send("提问");
		onChunk!("你");
		onChunk!("好");
		onChunk!("。");

		expect(useTrainingStore.getState().messages[1]?.content).toBe("");
		expect(frames).toHaveLength(1);
		frames[0]?.(0);
		expect(useTrainingStore.getState().messages[1]?.content).toBe("你好。");

		onDone!();
		releaseStream!();
		await promise;
	});

	it("stream error with partial content marks message with error", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const onError = vi.fn();

		const promise = manager.send("提问", { onError });
		cb.onChunk("部分回复");
		cb.onError("连接中断");
		await promise;

		const msgs = useTrainingStore.getState().messages;
		expect(msgs).toHaveLength(2);
		expect(msgs[1].streamError).toBe("连接中断");
		expect(msgs[1].streaming).toBe(false);
		expect(onError).toHaveBeenCalledWith("连接中断");
		expect(useTrainingStore.getState().sending).toBe(false);
	});

	it("stream error without content removes both messages", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const promise = manager.send("提问", {});
		cb.onError("失败");
		await promise;
		expect(useTrainingStore.getState().messages).toHaveLength(0);
	});

	it("api rejection rolls back and notifies", async () => {
		mockStream.mockRejectedValue(new Error("服务器异常"));
		const manager = new StreamManager(1);
		const onError = vi.fn();

		await manager.send("提问", { onError });

		expect(onError).toHaveBeenCalledWith("服务器异常");
		expect(useTrainingStore.getState().messages).toHaveLength(0);
		expect(useTrainingStore.getState().sending).toBe(false);
	});

	it("propagates emotion/initiative-state callbacks", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const onEmotionChange = vi.fn();
		const onInitiativeState = vi.fn();

		const promise = manager.send("提问", { onEmotionChange, onInitiativeState });
		cb.onEmotion({ state: "anxious", trust: 40, comfort: 30 });
		cb.onInitiativeState({ percent: 50 });
		cb.onDone();
		await promise;

		expect(onEmotionChange).toHaveBeenCalledWith({ state: "anxious", trust: 40, comfort: 30 });
		expect(onInitiativeState).toHaveBeenCalledWith({ percent: 50 });
	});

	it("abort() aborts the in-flight request and clears sending", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const promise = manager.send("提问", {});
		expect(cb.signal.aborted).toBe(false);

		manager.abort();
		expect(cb.signal.aborted).toBe(true);
		expect(useTrainingStore.getState().sending).toBe(false);

		cb.onError("aborted");
		await promise;
	});

	it("dispose aborts too", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const promise = manager.send("提问", {});
		manager.dispose();
		expect(cb.signal.aborted).toBe(true);
		cb.onDone();
		await promise;
	});

	it("setRecordId updates target record", async () => {
		const manager = new StreamManager(1);
		manager.setRecordId(2);
		const cb = captureCallbacks();
		const promise = manager.send("提问", {});
		expect(mockStream.mock.calls[0][0]).toBe(2);
		cb.onDone();
		await promise;
	});
});

describe("StreamManager.interrupt（打断 barge-in）", () => {
	it("中止在途回复、冻结患者已说出的部分（不标错误），学生的打断消息不被并发保护丢弃", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const promise = manager.send("我哪里不舒服？", {});
		cb.onChunk("你");
		cb.onChunk("好");
		expect(useTrainingStore.getState().sending).toBe(true);

		manager.interrupt();

		expect(cb.signal.aborted).toBe(true);
		expect(useTrainingStore.getState().sending).toBe(false);
		const [student, patient] = useTrainingStore.getState().messages;
		expect(student.content).toBe("我哪里不舒服？");
		// 学生听得见的那半句必须留下，且不能永远停在"正在输入"、也不能变成错误
		expect(patient.content).toBe("你好");
		expect(patient.streaming).toBe(false);
		expect(patient.streamError).toBeUndefined();
		await promise;

		// 打断消息必须真能进入发送链：send() 在 sending=true 时会静默丢弃
		const cb2 = captureCallbacks();
		await manager.send("等一下，我先问别的", {});

		const messages = useTrainingStore.getState().messages;
		expect(cb2.signal.aborted).toBe(false);
		expect(messages).toHaveLength(4);
		expect(messages[2].content).toBe("等一下，我先问别的");
	});

	it("一个字都还没说出口就打断 → 撤掉空占位，不留空气泡", async () => {
		const cb = captureCallbacks();
		const manager = new StreamManager(1);
		const promise = manager.send("我哪里不舒服？", {});
		expect(useTrainingStore.getState().messages).toHaveLength(2);

		manager.interrupt();

		const messages = useTrainingStore.getState().messages;
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("student");
		expect(useTrainingStore.getState().sending).toBe(false);
		await promise;
		expect(cb.signal.aborted).toBe(true);
	});
});
