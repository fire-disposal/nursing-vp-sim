import type { PhoneStage } from "./types";

export type PhoneInterruptionSource = "user" | "manual";

/** 只有真实发生过的内容才能进入对话记录；状态单独表达等待/识别，不伪造文本。 */
export interface PhoneCallLine {
	id: number;
	role: "user" | "patient";
	text: string;
	state: "streaming" | "complete" | "interrupted";
	interruptedBy?: PhoneInterruptionSource;
}

export interface PhoneCallState {
	stage: PhoneStage;
	lines: PhoneCallLine[];
}

export type PhoneCallAction =
	| { type: "reset" }
	| { type: "stage"; stage: PhoneStage }
	| { type: "opening"; line: PhoneCallLine }
	| { type: "user"; line: PhoneCallLine }
	| { type: "patient_chunk"; id: number; chunk: string }
	| { type: "patient_done"; id: number }
	| { type: "patient_error"; id: number | null }
	| { type: "patient_stopped"; id: number | null; by: PhoneInterruptionSource };

export const initialPhoneCallState: PhoneCallState = { stage: "idle", lines: [] };

/** 通话记录与消息生命周期的唯一写入入口。 */
export function phoneCallReducer(state: PhoneCallState, action: PhoneCallAction): PhoneCallState {
	switch (action.type) {
		case "reset":
			return initialPhoneCallState;
		case "stage":
			return { ...state, stage: action.stage };
		case "opening":
			return { stage: "greeting", lines: [action.line] };
		case "user":
			return { ...state, lines: [...state.lines, action.line] };
		case "patient_chunk": {
			const existing = state.lines.find((line) => line.id === action.id);
			const lines = existing
				? state.lines.map((line) =>
						line.id === action.id ? { ...line, text: line.text + action.chunk, state: "streaming" as const } : line,
					)
				: [
						...state.lines,
						{ id: action.id, role: "patient" as const, text: action.chunk, state: "streaming" as const },
					];
			return { ...state, lines };
		}
		case "patient_done":
			return {
				...state,
				lines: state.lines.map((line) =>
					line.id === action.id && line.text ? { ...line, state: "complete" as const } : line,
				),
			};
		case "patient_error":
			return {
				...state,
				lines: state.lines.flatMap((line) => {
					if (line.id !== action.id) return [line];
					if (!line.text.trim()) return [];
					return [{ ...line, state: "complete" as const }];
				}),
			};
		case "patient_stopped":
			return {
				...state,
				lines: state.lines.flatMap((line) => {
					if (line.id !== action.id) return [line];
					if (!line.text.trim()) return [];
					return [{ ...line, state: "interrupted" as const, interruptedBy: action.by }];
				}),
			};
	}
}
