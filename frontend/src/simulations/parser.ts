/** Slash-command parser — the React adapter that turns text into structured
 * actions (MVP-B §3.3). The engine only ever receives structured actions.
 *
 * The parser is deliberately thin on target validation: for the lab / assess
 * commands it passes the raw target through to the backend, which answers with
 * the full list of available options and their status (cost, turnaround,
 * pending, budget) printed inline — the console never pops a modal for a typo.
 */

export type SimActionType =
	| "ASSESS"
	| "ORDER"
	| "VIEW"
	| "MONITOR"
	| "CONSULT"
	| "DIAG"
	| "FLUIDS"
	| "TRANSFUSE"
	| "ANALGESIA"
	| "REPORT"
	| "WAIT"
	| "WAIT_CBC"
	| "STATUS"
	| "HISTORY"
	| "HELP"
	| "PENDING"
	| "CASE";

export interface ParsedAction {
	type: SimActionType;
	target?: string;
}

export type ParseResult = { action: ParsedAction } | { error: string };

export function parseCommand(raw: string): ParseResult {
	const input = raw.trim();
	if (!input.startsWith("/")) {
		return { error: "命令需以 / 开头。输入 /help 查看可用命令。" };
	}
	const [head, ...rest] = input.slice(1).split(/\s+/);
	const cmd = head.toLowerCase();
	const target = rest.join(" ").toLowerCase() || undefined;

	switch (cmd) {
		case "status":
			return { action: { type: "STATUS" } };
		case "assess":
			return { action: { type: "ASSESS", target } };
		case "order":
			return { action: { type: "ORDER", target } };
		case "view":
			return { action: { type: "VIEW", target } };
		case "monitor":
			return { action: { type: "MONITOR", target: "vitals" } };
		case "consult":
			return { action: { type: "CONSULT" } };
		case "diag":
			return { action: { type: "DIAG", target: rest.join(" ") } };
		case "give":
			if (target === "fluids") return { action: { type: "FLUIDS" } };
			return { error: "仅支持 /give fluids（快速补液）。" };
		case "transfuse":
			return { action: { type: "TRANSFUSE" } };
		case "analgesia":
			return { action: { type: "ANALGESIA" } };
		case "report":
			return { action: { type: "REPORT", target: "doctor" } };
		case "wait":
			if (target === "cbc") return { action: { type: "WAIT_CBC" } };
			return { action: { type: "WAIT" } };
		case "history":
			return { action: { type: "HISTORY" } };
		case "help":
			return { action: { type: "HELP", target } };
		case "pending":
			return { action: { type: "PENDING" } };
		case "case":
			return { action: { type: "CASE", target } };
		default:
			return { error: `未知命令：/${cmd}。输入 /help 查看可用命令。` };
	}
}
