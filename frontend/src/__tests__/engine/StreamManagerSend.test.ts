import { beforeEach, describe, expect, it, vi } from "vitest";
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
	onDone: (id?: number) => void;
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
		cb.onDone(42);
		await promise;

		const msgs = useTrainingStore.getState().messages;
		expect(msgs[1].content).toBe("你好");
		expect(msgs[1].streaming).toBe(false);
		expect(msgs[1].id).toBe("42");
		expect(useTrainingStore.getState().sending).toBe(false);
		expect(onPatientChunk).toHaveBeenCalledTimes(2);
		expect(onPatientDone).toHaveBeenCalledWith(42);
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
