import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import { ConversationComposer } from "@/components/training/ConversationComposer";

function mockSpeechRecognition() {
	const rec = {
		lang: "",
		interimResults: false,
		continuous: false,
		start: vi.fn(),
		stop: vi.fn(),
		onresult: null as null | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void),
		onend: null as null | (() => void),
		onerror: null as null | (() => void),
	};
	vi.stubGlobal("webkitSpeechRecognition", function WebkitSR() { return rec; });
	return rec;
}

describe("ConversationComposer（对话通道 / ASR 预留）", () => {
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

	it("语音按钮存在，转写结果进输入框后需确认发送（ASR 预留单出口）", async () => {
		const rec = mockSpeechRecognition();
		const onSend = vi.fn();
		render(<ConversationComposer onSend={onSend} />);
		const voiceBtn = screen.getByLabelText("语音输入");
		fireEvent.click(voiceBtn);
		expect(rec.start).toHaveBeenCalled();

		// 模拟转写回调 → 文本进输入框
		await waitFor(() => {
			rec.onresult?.({ results: [[{ transcript: "我这两天喘不上气" }]] });
		});
		const input = screen.getByLabelText("对话输入") as HTMLTextAreaElement;
		await waitFor(() => expect(input.value).toContain("喘不上气"));

		// 确认后发送（转写与文本共用 send）
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onSend).toHaveBeenCalledWith("我这两天喘不上气");
	});

	it("通话模式入口占位存在（规划中，disabled）", () => {
		render(<ConversationComposer onSend={vi.fn()} />);
		const callBtn = screen.getByLabelText("通话模式（规划中）");
		expect(callBtn).toBeDisabled();
	});
});
