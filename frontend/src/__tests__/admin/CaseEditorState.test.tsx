import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCaseEditor } from "@/components/admin/cases/CaseEditorState";

const BASE = {
	name: "",
	chief_complaint: "",
	present_illness: "",
	hidden_info: [],
} as const;

function makeJson(overrides: Record<string, unknown>) {
	return { ...BASE, ...overrides } as never;
}

describe("CaseEditorState 撤销栈", () => {
	it("PUSH_SNAPSHOT + SET_JSON 后 UNDO 恢复快照", () => {
		const { result } = renderHook(() => useCaseEditor());
		act(() => {
			result.current.dispatch({ type: "PUSH_SNAPSHOT" });
			result.current.dispatch({ type: "SET_JSON", json: makeJson({ name: "AI 生成的病例" }) });
		});
		expect(result.current.state.json.name).toBe("AI 生成的病例");
		expect(result.current.state.undoStack).toHaveLength(1);

		act(() => {
			result.current.dispatch({ type: "UNDO" });
		});
		expect(result.current.state.json.name).toBe("");
		expect(result.current.state.undoStack).toHaveLength(0);
	});

	it("空栈 UNDO 为无操作", () => {
		const { result } = renderHook(() => useCaseEditor());
		act(() => {
			result.current.dispatch({ type: "UNDO" });
		});
		expect(result.current.state.json.name).toBe("");
	});

	it("栈上限 10 步", () => {
		const { result } = renderHook(() => useCaseEditor());
		for (let i = 0; i < 12; i++) {
			act(() => {
				result.current.dispatch({ type: "PUSH_SNAPSHOT" });
				result.current.dispatch({ type: "SET_JSON", json: makeJson({ name: `step-${i}` }) });
			});
		}
		expect(result.current.state.undoStack.length).toBeLessThanOrEqual(10);
	});

	it("LOAD_CASE 清空撤销栈", () => {
		const { result } = renderHook(() => useCaseEditor());
		act(() => {
			result.current.dispatch({ type: "PUSH_SNAPSHOT" });
			result.current.dispatch({ type: "LOAD_CASE", json: makeJson({ name: "加载的病例" }) });
		});
		expect(result.current.state.undoStack).toHaveLength(0);
	});
});
