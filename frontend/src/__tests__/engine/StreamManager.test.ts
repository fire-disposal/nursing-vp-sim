import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamManager } from "@/engine/StreamManager";
import { getTrainingState, useTrainingStore } from "@/stores/trainingStore";
import type { ChatMessage } from "@/engine/types";

const msg = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content });

vi.mock("@/api", () => ({
	sendMessageStream: vi.fn(),
}));

import { sendMessageStream } from "@/api";

const mockStream = sendMessageStream as ReturnType<typeof vi.fn>;

function resetStore() {
	useTrainingStore.setState({
		messages: [],
		sending: false,
	});
}

/** Read current messages from store (fresh snapshot — not stale) */
function msgs(): ChatMessage[] {
	return useTrainingStore.getState().messages;
}

describe("StreamManager.send 拦截反馈", () => {
	beforeEach(() => {
		mockStream.mockReset();
		resetStore();
	});

	it("recordId 为空：通过 onError 通知用户，不产生孤儿消息", async () => {
		const m = new StreamManager(null);
		const onError = vi.fn();

		await m.send("你好", { onError });

		expect(onError).toHaveBeenCalledWith("训练尚未就绪，请稍后重试");
		expect(msgs()).toHaveLength(0);
		expect(useTrainingStore.getState().sending).toBe(false);
		expect(mockStream).not.toHaveBeenCalled();
	});

	it("发送中重复 send：直接忽略且不打扰用户", async () => {
		const m = new StreamManager(1);
		mockStream.mockReturnValue(new Promise(() => {}));
		const onError = vi.fn();

		useTrainingStore.setState({ sending: true, messages: [msg("1", "student", "hello")] });

		await m.send("again", { onError });

		expect(onError).not.toHaveBeenCalled();
		expect(mockStream).not.toHaveBeenCalled();
	});
});

describe("mergeHistory 轮询回填去重（消息重复事故回归）", () => {
	beforeEach(() => resetStore());

	it("本地 UUID 学生消息 vs 服务器数字 id：按内容去重不重复追加", () => {
		const store = getTrainingState();
		store.setMessages([msg(crypto.randomUUID(), "student", "你哪里不舒服？")]);

		const added = store.mergeHistory([msg("101", "student", "你哪里不舒服？")]);
		expect(added).toBe(0);
		expect(msgs()).toHaveLength(1);
	});

	it("本地 number id 患者消息 vs 服务器 string id：归一化后按 id 去重", () => {
		const store = getTrainingState();
		store.setMessages([{ id: 102, role: "patient", content: "我胸口疼" }]);

		const added = store.mergeHistory([msg("102", "patient", "我胸口疼")]);
		expect(added).toBe(0);
		expect(msgs()).toHaveLength(1);
	});

	it("整轮对话回填（学生+患者）均不重复；新增历史正常追加", () => {
		const store = getTrainingState();
		store.setMessages([
			msg(crypto.randomUUID(), "student", "疼多久了？"),
			msg(crypto.randomUUID(), "patient", "三天了"),
		]);

		const added = store.mergeHistory([
			msg("201", "student", "疼多久了？"),
			msg("202", "patient", "三天了"),
			msg("203", "patient", "好的我来查一下"),
		]);
		expect(added).toBe(1);
		const latest = msgs();
		expect(latest).toHaveLength(3);
		expect(latest[2].content).toBe("好的我来查一下");
	});

	it("同一内容发送两次：服务器两个副本都被过滤，本地保留恰好两条", () => {
		const store = getTrainingState();
		store.setMessages([
			msg(crypto.randomUUID(), "student", "嗯"),
			msg(crypto.randomUUID(), "student", "嗯"),
		]);

		const added = store.mergeHistory([
			msg("301", "student", "嗯"),
			msg("302", "student", "嗯"),
		]);
		expect(added).toBe(0);
		expect(msgs()).toHaveLength(2);
	});

	it("幂等：同一历史重复合并多次不增长", () => {
		const store = getTrainingState();
		const history = [
			msg("401", "student", "你好"),
			msg("402", "patient", "您好，护士"),
		];

		expect(store.mergeHistory(history)).toBe(2);
		expect(store.mergeHistory(history)).toBe(0);
		expect(msgs()).toHaveLength(2);
	});

	it("空列表与全重复时返回 0 且不触发额外追加", () => {
		const store = getTrainingState();
		expect(store.mergeHistory([])).toBe(0);
		store.setMessages([msg("1", "student", "测试")]);
		expect(store.mergeHistory([msg("1", "student", "测试")])).toBe(0);
		expect(msgs()).toHaveLength(1);
	});
});
