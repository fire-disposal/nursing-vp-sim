import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import { ConversationComposer } from "@/components/training/ConversationComposer";

afterEach(() => {
	vi.unstubAllGlobals();
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
		onerror: null as null | (() => void),
	};
	vi.stubGlobal("webkitSpeechRecognition", function WebkitSR() { return rec; });
	return rec;
}

describe("ConversationComposer（半双工对讲机式语音对答 MVP）", () => {
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

	it("按住麦克风说话 → 实时转写 → 松开自动发送（对讲机式）", async () => {
		const rec = mockSpeechRecognition();
		const onSend = vi.fn();
		render(<ConversationComposer onSend={onSend} />);
		const micBtn = screen.getByLabelText("语音输入");

		fireEvent.pointerDown(micBtn);
		expect(rec.start).toHaveBeenCalled();

		// 实时转写显示在状态行（不写进输入框）。
		act(() => {
			rec.onresult?.({ results: [[{ transcript: "我这两天喘不上气" }]] });
		});
		await waitFor(() => {
			expect(screen.getByText(/喘不上气/)).toBeInTheDocument();
		});

		// 松开 → 自动发送当前转写。
		fireEvent.pointerUp(micBtn);
		expect(onSend).toHaveBeenCalledWith("我这两天喘不上气");
	});

	it("浏览器不支持语音 → 麦克风按钮禁用", () => {
		render(<ConversationComposer onSend={vi.fn()} />);
		expect(screen.getByLabelText("语音输入")).toBeDisabled();
	});
});
