import { describe, expect, it } from "vitest";
import { initialPhoneCallState, phoneCallReducer } from "@/engine/phone/callMachine";

const userLine = { id: 1, role: "user" as const, text: "你好", state: "complete" as const };

describe("电话消息状态机", () => {
	it("等待回复时不创建患者气泡，首个内容块才创建", () => {
		let state = phoneCallReducer(initialPhoneCallState, { type: "user", line: userLine });
		state = phoneCallReducer(state, { type: "stage", stage: "waiting_reply" });
		expect(state.lines).toEqual([userLine]);
		state = phoneCallReducer(state, { type: "patient_chunk", id: 2, chunk: "我在。" });
		expect(state.lines.at(-1)).toMatchObject({ role: "patient", text: "我在。", state: "streaming" });
	});

	it("空回复和空打断都不会留下占位消息", () => {
		let state = phoneCallReducer(initialPhoneCallState, { type: "user", line: userLine });
		state = phoneCallReducer(state, { type: "patient_error", id: null });
		expect(state.lines).toEqual([userLine]);
		state = phoneCallReducer(state, { type: "patient_stopped", id: null, by: "user" });
		expect(state.lines).toEqual([userLine]);
	});

	it("只有当前患者行能被标记停播，不误伤历史消息", () => {
		const opening = { id: 1, role: "patient" as const, text: "你好", state: "complete" as const };
		let state = phoneCallReducer(initialPhoneCallState, { type: "opening", line: opening });
		state = phoneCallReducer(state, { type: "user", line: userLine });
		state = phoneCallReducer(state, { type: "patient_chunk", id: 2, chunk: "我正在回答" });
		state = phoneCallReducer(state, { type: "patient_stopped", id: 2, by: "user" });
		expect(state.lines[0]).toEqual(opening);
		expect(state.lines.at(-1)).toMatchObject({ state: "interrupted", interruptedBy: "user" });
	});
});
