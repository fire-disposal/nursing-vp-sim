import { describe, expect, it } from "vitest";
import { mergeClinicalChatLines } from "@/components/training/clinical-reasoning/chat-lines";
import type { ClinicalOutboxEntry } from "@/components/training/clinical-reasoning/useClinicalReasoning";

const persisted = [
	{ id: 11, role: "student", content: "你哪里不舒服？" },
	{ id: 12, role: "patient", content: "胸口闷。" },
];

const successfulPair: ClinicalOutboxEntry[] = [
	{ id: -1, persistedId: 11, role: "student", content: "你哪里不舒服？", sending: false },
	{ id: -2, persistedId: 12, role: "patient", content: "胸口闷。", sending: false },
];

describe("临床判断消息合并", () => {
	it("详情包含成功回合后移除本地副本，但保留发送中的消息", () => {
		const pending: ClinicalOutboxEntry = {
			id: -3,
			persistedId: null,
			role: "student",
			content: "持续多久了？",
			sending: true,
		};

		expect(mergeClinicalChatLines(persisted, [...successfulPair, pending])).toEqual([
			{ key: "record-message:11", role: "student", content: "你哪里不舒服？", sending: false, messageId: 11 },
			{ key: "record-message:12", role: "patient", content: "胸口闷。", sending: false, messageId: 12 },
			{ key: "local:-3", role: "student", content: "持续多久了？", sending: true, messageId: null },
		]);
	});

	it("不会把相同文本但不同 ID 的回合误判为已持久化", () => {
		const repeated: ClinicalOutboxEntry = {
			id: -3,
			persistedId: 13,
			role: "student",
			content: "你哪里不舒服？",
			sending: false,
		};

		const lines = mergeClinicalChatLines(persisted, [repeated]);
		expect(lines.filter((line) => line.content === "你哪里不舒服？")).toHaveLength(2);
	});
});
