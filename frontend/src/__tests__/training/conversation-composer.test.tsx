import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/__tests__/render";
import { ConversationComposer } from "@/components/training/ConversationComposer";

const { voiceState } = vi.hoisted(() => ({
	voiceState: {
		phase: "idle",
		transcript: "",
		supported: true,
		notice: null as string | null,
		continuousArmed: false,
		continuousFailed: false,
		interrupted: false,
		basicVoiceMode: false,
		start: vi.fn(),
		stop: vi.fn(),
		pressStart: vi.fn(),
		pressEnd: vi.fn(),
		reset: vi.fn(),
	},
}));

vi.mock("@/hooks/useVoiceDialogue", () => ({
	useVoiceDialogue: () => voiceState,
}));

function renderComposer(onSend = vi.fn()) {
	return { onSend, ...render(<ConversationComposer onSend={onSend} />) };
}

beforeEach(() => {
	Object.assign(voiceState, {
		phase: "idle",
		transcript: "",
		supported: true,
		notice: null,
		continuousArmed: false,
		continuousFailed: false,
		interrupted: false,
		basicVoiceMode: false,
	});
	for (const fn of [voiceState.start, voiceState.stop, voiceState.pressStart, voiceState.pressEnd, voiceState.reset]) {
		fn.mockClear();
	}
});

describe("ConversationComposer 文本与语音输入", () => {
	it("从语音模式启动持续对谈，切回文字会关闭麦克风", async () => {
		voiceState.continuousArmed = true;
		renderComposer();

		await userEvent.click(screen.getByRole("button", { name: "语音" }));
		expect(screen.getByRole("button", { name: "停止持续对谈" })).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "文字" }));

		expect(voiceState.reset).toHaveBeenCalledTimes(1);
		expect(screen.getByLabelText("对患者说的话")).toBeTruthy();
	});

	it("语音面板展示实时转写与低性能降级说明", async () => {
		Object.assign(voiceState, {
			continuousArmed: true,
			transcript: "我想问哪里不舒服",
			basicVoiceMode: true,
			notice: "当前设备已使用基础语音模式",
		});
		renderComposer();

		await userEvent.click(screen.getByRole("button", { name: "语音" }));

		expect(screen.getByLabelText("实时转写").textContent).toBe("我想问哪里不舒服");
		expect(screen.getByText("当前设备已使用基础语音模式")).toBeTruthy();
		expect(screen.getByRole("button", { name: "停止持续对谈" })).toBeTruthy();
	});

	it("Enter 发送文字，中文组词期间 Enter 不发送", async () => {
		const onSend = vi.fn();
		renderComposer(onSend);
		const input = screen.getByLabelText("对患者说的话");

		fireEvent.change(input, { target: { value: "哪里不舒服" } });
		fireEvent.compositionStart(input);
		fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
		expect(onSend).not.toHaveBeenCalled();

		fireEvent.compositionEnd(input);
		fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
		expect(onSend).toHaveBeenCalledWith("哪里不舒服");
	});
});
