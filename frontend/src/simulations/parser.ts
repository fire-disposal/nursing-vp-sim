/** Slash-command parser — the React adapter that turns text into structured
 * actions (MVP-B §3.3). The engine only ever receives structured actions; no
 * slash strings cross the API boundary. */

export type SimActionType =
	| "ASSESS"
	| "ORDER"
	| "MONITOR"
	| "REPORT"
	| "WAIT"
	| "WAIT_CBC"
	| "VIEW_CBC"
	| "STATUS"
	| "HISTORY"
	| "HELP"
	| "PENDING";

export interface ParsedAction {
	type: SimActionType;
	target?: string;
}

export type ParseResult = { action: ParsedAction } | { error: string };

export function parseCommand(raw: string): ParseResult {
	const input = raw.trim();
	if (!input.startsWith("/")) {
		return { error: "命令需以 / 开头（输入 /help 查看帮助）" };
	}
	const [head, ...rest] = input.slice(1).split(/\s+/);
	const cmd = head.toLowerCase();
	const target = rest.join(" ").toLowerCase() || undefined;

	switch (cmd) {
		case "status":
			return { action: { type: "STATUS" } };
		case "assess":
			if (target === "vitals" || target === "drain") {
				return { action: { type: "ASSESS", target } };
			}
			return { error: "/assess 需要 vitals 或 drain" };
		case "order":
			if (target === "cbc") return { action: { type: "ORDER", target: "cbc" } };
			return { error: "/order 仅支持 cbc" };
		case "monitor":
			if (target === "vitals") return { action: { type: "MONITOR", target: "vitals" } };
			return { error: "/monitor 仅支持 vitals" };
		case "report":
			return { action: { type: "REPORT", target: "doctor" } };
		case "wait":
			if (target === "cbc") return { action: { type: "WAIT_CBC" } };
			return { action: { type: "WAIT" } };
		case "view":
			if (target === "cbc") return { action: { type: "VIEW_CBC" } };
			return { error: "/view 仅支持 cbc" };
		case "history":
			return { action: { type: "HISTORY" } };
		case "help":
			return { action: { type: "HELP" } };
		case "pending":
			return { action: { type: "PENDING" } };
		default:
			return { error: `未知命令：/${cmd}（输入 /help 查看帮助）` };
	}
}
