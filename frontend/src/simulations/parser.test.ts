import { describe, expect, it } from "vitest";
import { parseCommand } from "./parser";

describe("parseCommand", () => {
	it("parses every supported command into a structured action", () => {
		expect(parseCommand("/status")).toEqual({ action: { type: "STATUS" } });
		expect(parseCommand("/assess vitals")).toEqual({ action: { type: "ASSESS", target: "vitals" } });
		expect(parseCommand("/assess drain")).toEqual({ action: { type: "ASSESS", target: "drain" } });
		expect(parseCommand("/assess pain")).toEqual({ action: { type: "ASSESS", target: "pain" } });
		expect(parseCommand("/assess urine")).toEqual({ action: { type: "ASSESS", target: "urine" } });
		expect(parseCommand("/order cbc")).toEqual({ action: { type: "ORDER", target: "cbc" } });
		expect(parseCommand("/order abg")).toEqual({ action: { type: "ORDER", target: "abg" } });
		expect(parseCommand("/order coag")).toEqual({ action: { type: "ORDER", target: "coag" } });
		expect(parseCommand("/order us")).toEqual({ action: { type: "ORDER", target: "us" } });
		expect(parseCommand("/view cbc")).toEqual({ action: { type: "VIEW", target: "cbc" } });
		expect(parseCommand("/view abg")).toEqual({ action: { type: "VIEW", target: "abg" } });
		expect(parseCommand("/monitor vitals")).toEqual({ action: { type: "MONITOR", target: "vitals" } });
		expect(parseCommand("/give fluids")).toEqual({ action: { type: "FLUIDS" } });
		expect(parseCommand("/consult")).toEqual({ action: { type: "CONSULT" } });
		expect(parseCommand("/transfuse")).toEqual({ action: { type: "TRANSFUSE" } });
		expect(parseCommand("/analgesia")).toEqual({ action: { type: "ANALGESIA" } });
		expect(parseCommand("/report doctor")).toEqual({ action: { type: "REPORT", target: "doctor" } });
		expect(parseCommand("/diag 疑诊隐匿性出血")).toEqual({ action: { type: "DIAG", target: "疑诊隐匿性出血" } });
		expect(parseCommand("/wait")).toEqual({ action: { type: "WAIT" } });
		expect(parseCommand("/wait cbc")).toEqual({ action: { type: "WAIT_CBC" } });
		expect(parseCommand("/history")).toEqual({ action: { type: "HISTORY" } });
		expect(parseCommand("/help")).toEqual({ action: { type: "HELP" } });
		expect(parseCommand("/help order")).toEqual({ action: { type: "HELP", target: "order" } });
		expect(parseCommand("/pending")).toEqual({ action: { type: "PENDING" } });
		expect(parseCommand("/case")).toEqual({ action: { type: "CASE" } });
		expect(parseCommand("/case mvpb-1")).toEqual({ action: { type: "CASE", target: "mvpb-1" } });
		expect(parseCommand("/talk patient 你现在感觉怎么样？")).toEqual({
			action: { type: "TALK", target: "patient", text: "你现在感觉怎么样？" },
		});
		expect(parseCommand("/talk family 他夜里睡得怎么样")).toEqual({
			action: { type: "TALK", target: "family", text: "他夜里睡得怎么样" },
		});
		expect(parseCommand("/talk doctor 你好")).toEqual({ error: expect.stringContaining("patient") });
	});

	it("passes raw targets through so the backend can guide on typos", () => {
		// Target validation (and guidance listing available options) is the
		// backend's job, printed inline — the parser must not hard-block.
		expect(parseCommand("/order mri")).toEqual({ action: { type: "ORDER", target: "mri" } });
		expect(parseCommand("/assess xray")).toEqual({ action: { type: "ASSESS", target: "xray" } });
		expect(parseCommand("/view xray")).toEqual({ action: { type: "VIEW", target: "xray" } });
		expect(parseCommand("/order")).toEqual({ action: { type: "ORDER" } });
	});

	it("is case-insensitive and tolerant of whitespace", () => {
		expect(parseCommand("  /Assess  VITALS ")).toEqual({ action: { type: "ASSESS", target: "vitals" } });
		expect(parseCommand("/WAIT   CBC")).toEqual({ action: { type: "WAIT_CBC" } });
		expect(parseCommand("/GIVE FLUIDS")).toEqual({ action: { type: "FLUIDS" } });
	});

	it("rejects commands without a slash", () => {
		const r = parseCommand("order cbc");
		expect("error" in r).toBe(true);
	});

	it("rejects unknown commands and unsupported give targets", () => {
		expect("error" in parseCommand("/xyz")).toBe(true);
		expect("error" in parseCommand("/give plasma")).toBe(true);
	});
});
