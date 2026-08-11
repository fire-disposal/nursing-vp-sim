import { describe, expect, it } from "vitest";
import { parseCommand } from "./parser";

describe("parseCommand", () => {
	it("parses every supported command into a structured action", () => {
		expect(parseCommand("/status")).toEqual({ action: { type: "STATUS" } });
		expect(parseCommand("/assess vitals")).toEqual({ action: { type: "ASSESS", target: "vitals" } });
		expect(parseCommand("/assess drain")).toEqual({ action: { type: "ASSESS", target: "drain" } });
		expect(parseCommand("/order cbc")).toEqual({ action: { type: "ORDER", target: "cbc" } });
		expect(parseCommand("/monitor vitals")).toEqual({ action: { type: "MONITOR", target: "vitals" } });
		expect(parseCommand("/report doctor")).toEqual({ action: { type: "REPORT", target: "doctor" } });
		expect(parseCommand("/wait")).toEqual({ action: { type: "WAIT" } });
		expect(parseCommand("/wait cbc")).toEqual({ action: { type: "WAIT_CBC" } });
		expect(parseCommand("/view cbc")).toEqual({ action: { type: "VIEW_CBC" } });
		expect(parseCommand("/history")).toEqual({ action: { type: "HISTORY" } });
		expect(parseCommand("/help")).toEqual({ action: { type: "HELP" } });
		expect(parseCommand("/pending")).toEqual({ action: { type: "PENDING" } });
	});

	it("is case-insensitive and tolerant of whitespace", () => {
		expect(parseCommand("  /Assess  VITALS ")).toEqual({ action: { type: "ASSESS", target: "vitals" } });
		expect(parseCommand("/WAIT   CBC")).toEqual({ action: { type: "WAIT_CBC" } });
	});

	it("rejects commands without a slash", () => {
		const r = parseCommand("order cbc");
		expect("error" in r).toBe(true);
	});

	it("rejects unknown commands", () => {
		const r = parseCommand("/xyz");
		expect("error" in r).toBe(true);
	});

	it("rejects wrong targets for assess/order/view", () => {
		expect("error" in parseCommand("/assess urine")).toBe(true);
		expect("error" in parseCommand("/order mri")).toBe(true);
		expect("error" in parseCommand("/view xray")).toBe(true);
		expect("error" in parseCommand("/monitor pulse")).toBe(true);
	});
});
