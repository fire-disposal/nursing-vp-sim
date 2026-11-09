import { render, screen, waitFor } from "@/__tests__/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageBus } from "@/engine/MessageBus";
import { ChatArea } from "@/components/training/ChatArea";
import { getTrainingState, useTrainingStore } from "@/stores/trainingStore";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";

describe("患者主动追问消息", () => {
	beforeEach(() => {
		useTrainingStore.getState().reset();
	});

	it("立即进入当前对话，重复事件按 id 去重", async () => {
		const bus = createMessageBus();
		useTrainingStore.getState().init({
			bus,
			recordId: "1",
			initialMessages: [],
			seed: {
				nursingRecordSheet: null,
				nursingRecordSubmittedAt: null,
				messageCorrection: null,
			},
		});
		const record = makeRecord({
			messages: [{ id: 1, role: "student", content: "你好", created_at: "2026-09-25T00:00:00+00:00" }],
		});
		render(withTrainingData(<ChatArea onSend={vi.fn()} onCorrectLast={vi.fn()} />, record));

		bus.emit("initiative:triggered", { id: 99, content: "你还不准备帮我吗？" });
		bus.emit("initiative:triggered", { id: 99, content: "你还不准备帮我吗？" });

		await screen.findByText("你还不准备帮我吗？");
		await waitFor(() => {
			expect(getTrainingState().messages.filter((message) => message.id === 99)).toHaveLength(1);
		});
	});
});
