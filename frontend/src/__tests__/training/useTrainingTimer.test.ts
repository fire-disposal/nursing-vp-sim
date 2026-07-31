import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";

const toastMock = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("@/components/Toast", () => ({
	useToast: () => toastMock,
}));

const START = "2026-07-31T10:00:00.000Z";
const START_MS = new Date(START).getTime();

describe("useTrainingTimer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(START_MS);
		toastMock.warning.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function renderTimer(overrides: Partial<Parameters<typeof useTrainingTimer>[0]> = {}) {
		return renderHook(() =>
			useTrainingTimer({
				startTime: START,
				timeLimitMinutes: 20,
				enabled: true,
				onAutoEnd: vi.fn(),
				...overrides,
			}),
		);
	}

	it("counts down from the wall-clock deadline", () => {
		const { result } = renderTimer();
		expect(result.current.remaining).toBe(1200);

		act(() => vi.advanceTimersByTime(1000));
		expect(result.current.remaining).toBe(1199);

		act(() => vi.advanceTimersByTime(59_000));
		expect(result.current.remaining).toBe(1140);
	});

	it("fires onAutoEnd exactly once at zero", () => {
		const onAutoEnd = vi.fn();
		const { result } = renderTimer({ onAutoEnd });

		act(() => vi.advanceTimersByTime(20 * 60 * 1000));
		expect(onAutoEnd).toHaveBeenCalledTimes(1);
		expect(result.current.remaining).toBe(0);

		act(() => vi.advanceTimersByTime(10_000));
		expect(onAutoEnd).toHaveBeenCalledTimes(1);
	});

	it("warns at 5 and 2 minutes, once each", () => {
		const { result } = renderTimer();

		act(() => vi.advanceTimersByTime(15 * 60 * 1000)); // 300s left
		expect(toastMock.warning).toHaveBeenCalledWith("训练时间剩余 5 分钟");

		act(() => vi.advanceTimersByTime(3 * 60 * 1000)); // 120s left
		expect(toastMock.warning).toHaveBeenCalledWith("训练时间剩余 2 分钟，即将自动结束");

		act(() => vi.advanceTimersByTime(60_000)); // 60s left — no repeats
		expect(toastMock.warning).toHaveBeenCalledTimes(2);
		expect(result.current.remaining).toBe(60);
	});

	it("does not tick when disabled", () => {
		const { result } = renderTimer({ enabled: false });
		expect(result.current.remaining).toBeNull();

		act(() => vi.advanceTimersByTime(60_000));
		expect(result.current.remaining).toBeNull();
	});

	it("returns null when startTime is missing", () => {
		const { result } = renderTimer({ startTime: null });
		expect(result.current.remaining).toBeNull();
	});

	it("formats as mm:ss", () => {
		const { result } = renderTimer();
		expect(result.current.formatTime(125)).toBe("02:05");
		expect(result.current.formatTime(0)).toBe("00:00");
		expect(result.current.formatTime(null)).toBe("--:--");
		expect(result.current.formatTime(-3)).toBe("--:--");
	});
});
