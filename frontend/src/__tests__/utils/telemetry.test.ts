import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGlobalTelemetry, reportError, setTelemetryUserId } from "@/utils/telemetry";

const beacon = vi.fn();

type SentEntry = {
	type: string;
	message: string;
	url: string;
	user_id: number;
	source: string;
};

type SentPayload = { errors: SentEntry[] };

async function sentPayloads(): Promise<SentPayload[]> {
	const payloads: SentPayload[] = [];
	for (const call of beacon.mock.calls) {
		payloads.push(JSON.parse(await (call[1] as Blob).text()));
	}
	return payloads;
}

beforeEach(() => {
	vi.useFakeTimers();
	beacon.mockReset();
	Object.defineProperty(window.navigator, "sendBeacon", { value: beacon, configurable: true });
});

afterEach(() => {
	// flush any pending timer-based batch so module buffer starts empty next test
	vi.advanceTimersByTime(10000);
	vi.useRealTimers();
});

describe("reportError", () => {
	it("flushes batch when 5 errors accumulate", async () => {
		for (let i = 0; i < 5; i += 1) {
			reportError("TypeError", `msg-${i}`);
		}
		expect(beacon).toHaveBeenCalledTimes(1);
		const payload = (await sentPayloads())[0];
		expect(payload.errors).toHaveLength(5);
		expect(payload.errors[0].message).toBe("msg-0");
	});

	it("flushes on 10s timer when fewer than 5", async () => {
		reportError("Error", "single");
		expect(beacon).not.toHaveBeenCalled();
		vi.advanceTimersByTime(10000);
		expect(beacon).toHaveBeenCalledTimes(1);
		expect((await sentPayloads())[0].errors).toHaveLength(1);
	});

	it("sanitizes tokens from url", async () => {
		reportError("Error", "x", "https://example.com/api?token=secret123&a=1", { source: "test" });
		vi.advanceTimersByTime(10000);
		const errors = (await sentPayloads())[0].errors;
		expect(errors[0].url).toContain("token=***");
		expect(errors[0].url).not.toContain("secret123");
	});

	it("truncates message and type", async () => {
		reportError("T".repeat(500), "M".repeat(5000));
		vi.advanceTimersByTime(10000);
		const e = (await sentPayloads())[0].errors[0];
		expect(e.type).toHaveLength(200);
		expect(e.message).toHaveLength(1000);
	});

	it("records user id from setTelemetryUserId", async () => {
		setTelemetryUserId(42);
		reportError("Error", "x");
		vi.advanceTimersByTime(10000);
		expect((await sentPayloads())[0].errors[0].user_id).toBe(42);
	});
});

describe("installGlobalTelemetry", () => {
	it("installs window error handler that reports", async () => {
		installGlobalTelemetry();
		const err = new TypeError("window boom");
		window.dispatchEvent(new ErrorEvent("error", { error: err, message: "window boom" }));
		vi.advanceTimersByTime(10000);
		const errors = (await sentPayloads())[0].errors;
		expect(errors[0].message).toBe("window boom");
		expect(errors[0].source).toBe("window.error");
	});

	it("is idempotent", () => {
		const spy = vi.spyOn(window, "addEventListener");
		installGlobalTelemetry();
		installGlobalTelemetry();
		// error + unhandledrejection handlers installed once each
		const errorCalls = spy.mock.calls.filter(([type]) => type === "error");
		expect(errorCalls.length).toBeLessThanOrEqual(1);
	});
});
