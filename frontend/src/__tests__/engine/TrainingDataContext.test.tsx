import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TrainingDataProvider, useEmotionSeed } from "@/engine/TrainingDataContext";
import type { TrainingRecordDetail } from "@/engine/training-record-types";

/** 只关心 emotion 字段：其余字段由生成类型兜住，取最小可用记录。 */
function recordWith(emotion: unknown): TrainingRecordDetail {
	return { id: 1, emotion } as unknown as TrainingRecordDetail;
}

function seedOf(emotion: unknown) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<TrainingDataProvider value={recordWith(emotion)}>{children}</TrainingDataProvider>
	);
	return renderHook(() => useEmotionSeed(), { wrapper }).result.current;
}

describe("useEmotionSeed（v3 契约：0-100 四维 + dominant_state）", () => {
	it("恢复会话种子取后端 4D 快照，而不是要求 comfort/state", () => {
		expect(
			seedOf({ trust: 30, anxiety: 70, irritation: 20, cooperation: 40, dominant_state: "trusting_anxious" }),
		).toEqual({
			trust: 30,
			anxiety: 70,
			irritation: 20,
			cooperation: 40,
			dominant_state: "trusting_anxious",
		});
	});

	it("缺 dominant_state 时回退 neutral 标签", () => {
		expect(seedOf({ trust: 55, anxiety: 10, irritation: 10, cooperation: 90 })?.dominant_state).toBe("neutral");
	});

	it("四维不完整（例如只有 trust/comfort 的 v2 载荷）不产生种子", () => {
		expect(seedOf({ trust: 30, comfort: 70, state: "anxious" })).toBeNull();
	});

	it("无 emotion 字段不产生种子", () => {
		expect(seedOf(null)).toBeNull();
		expect(seedOf(undefined)).toBeNull();
	});
});
