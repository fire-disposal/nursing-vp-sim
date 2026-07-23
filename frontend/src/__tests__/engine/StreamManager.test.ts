import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamManager } from "@/engine/StreamManager";
import type { ChatMessage } from "@/engine/types";

const msg = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content });

vi.mock("@/api", () => ({
	sendMessageStream: vi.fn(),
}));

import { sendMessageStream } from "@/api";

const mockStream = sendMessageStream as ReturnType<typeof vi.fn>;

describe("StreamManager.send 拦截反馈", () => {
	beforeEach(() => {
		mockStream.mockReset();
	});

	it("recordId 为空：通过 onError 通知用户，不产生孤儿消息", async () => {
		const m = new StreamManager(null);
		const onError = vi.fn();
		const loadingStates: boolean[] = [];
		m.onLoadingChange((l) => loadingStates.push(l));

		await m.send("你好", { onError });

		expect(onError).toHaveBeenCalledWith("训练尚未就绪，请稍后重试");
		expect(m.getMessages()).toHaveLength(0);
		expect(m.loading).toBe(false);
		expect(loadingStates).toEqual([true, false]);
		expect(mockStream).not.toHaveBeenCalled();
	});

	it("发送中重复 send：直接忽略且不打扰用户", async () => {
		const m = new StreamManager(1);
		// 流永不完成 → 一直保持 loading
		mockStream.mockReturnValue(new Promise(() => {}));
		const onError = vi.fn();

		void m.send("第一条", { onError });
		await Promise.resolve(); // 让首条消息入列
		expect(m.loading).toBe(true);
		const countAfterFirst = m.getMessages().length;

		await m.send("第二条", { onError });

		// 第二条被静默拦截（UI 已用 disabled 挡住，此处双保险）
		expect(m.getMessages().length).toBe(countAfterFirst);
		expect(onError).not.toHaveBeenCalled();
		m.abort();
		expect(m.loading).toBe(false);
	});
});

describe("StreamManager.mergeHistory 轮询回填去重（消息重复事故回归）", () => {
	it("本地 UUID 学生消息 vs 服务器数字 id：按内容去重不重复追加", () => {
		const m = new StreamManager(1);
		m.setMessages([msg(crypto.randomUUID(), "student", "你哪里不舒服？")]);

		const added = m.mergeHistory([msg("101", "student", "你哪里不舒服？")]);

		expect(added).toBe(0);
		expect(m.getMessages()).toHaveLength(1);
	});

	it("本地 number id 患者消息 vs 服务器 string id：归一化后按 id 去重", () => {
		const m = new StreamManager(1);
		m.setMessages([{ id: 102, role: "patient", content: "我胸口疼" }]);

		const added = m.mergeHistory([msg("102", "patient", "我胸口疼")]);

		expect(added).toBe(0);
		expect(m.getMessages()).toHaveLength(1);
	});

	it("整轮对话回填（学生+患者）均不重复；新增历史正常追加", () => {
		const m = new StreamManager(1);
		m.setMessages([
			msg(crypto.randomUUID(), "student", "疼多久了？"),
			msg(crypto.randomUUID(), "patient", "三天了"),
		]);

		// 15s 轮询返回服务器全量历史（含已存在的一轮 + 一条新的系统消息）
		const added = m.mergeHistory([
			msg("201", "student", "疼多久了？"),
			msg("202", "patient", "三天了"),
			msg("203", "system", "训练已恢复"),
		]);

		expect(added).toBe(1);
		expect(m.getMessages()).toHaveLength(3);
		expect(m.getMessages()[2]?.content).toBe("训练已恢复");
	});

	it("同一内容发送两次：服务器两个副本都被过滤，本地保留恰好两条", () => {
		const m = new StreamManager(1);
		m.setMessages([
			msg(crypto.randomUUID(), "student", "嗯"),
			msg(crypto.randomUUID(), "student", "嗯"),
		]);

		const added = m.mergeHistory([
			msg("301", "student", "嗯"),
			msg("302", "student", "嗯"),
		]);

		expect(added).toBe(0);
		expect(m.getMessages()).toHaveLength(2);
	});

	it("幂等：同一历史重复合并多次不增长", () => {
		const m = new StreamManager(1);
		const history = [
			msg("401", "student", "你好"),
			msg("402", "patient", "您好，护士"),
		];

		expect(m.mergeHistory(history)).toBe(2);
		expect(m.mergeHistory(history)).toBe(0);
		expect(m.mergeHistory(history)).toBe(0);
		expect(m.getMessages()).toHaveLength(2);
	});

	it("空列表与全重复时返回 0 且不触发额外追加", () => {
		const m = new StreamManager(1);
		expect(m.mergeHistory([])).toBe(0);
		m.setMessages([msg("1", "student", "测试")]);
		expect(m.mergeHistory([msg("1", "student", "测试")])).toBe(0);
		expect(m.getMessages()).toHaveLength(1);
	});
});
