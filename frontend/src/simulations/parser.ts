/** Slash-command parser — the React adapter that turns text into structured
 * actions (MVP-B §3.3). The engine only ever receives structured actions.
 *
 * The parser is deliberately thin on target validation: for the lab / assess
 * commands it passes the raw target through to the backend, which answers with
 * the full list of available options and their status (cost, turnaround,
 * pending, budget) printed inline — the console never pops a modal for a typo.
 *
 * 中文触发词：命令头与参数经 aliases.ts 翻译为后端英文 key，便于记忆。
 * 无需空格：`/评估生命体征` = `/评估 生命体征`、`/assessvitals` = `/assess vitals`——
 * 命令已合法时，命令头后的粘连文本按参数处理（splitHead）。
 */

import { COMMAND_ALIASES, translateCommand, translateTarget } from "./aliases";

export type SimActionType =
	| "ASSESS"
	| "ORDER"
	| "VIEW"
	| "MONITOR"
	| "CONSULT"
	| "TALK"
	| "DIAG"
	| "GIVE"
	| "REPORT"
	| "WAIT"
	| "STATUS"
	| "HISTORY"
	| "HELP"
	| "HINT"
	| "PENDING"
	| "CASE";

export interface ParsedAction {
	type: SimActionType;
	target?: string;
	text?: string;
}

export type ParseResult = { action: ParsedAction } | { error: string };

/** 全部英文命令名（与 SimActionType 小写对应），用于无空格粘连切分。 */
const COMMAND_NAMES: string[] = [
	"status",
	"assess",
	"order",
	"view",
	"monitor",
	"consult",
	"talk",
	"diag",
	"give",
	"report",
	"wait",
	"history",
	"help",
	"hint",
	"pending",
	"case",
];

/** 命令头切分：命令已合法时，粘连在后面的文本作为参数（无需空格）。
 * 例如 `评估生命体征` → head=评估 glued=生命体征；`assessvitals` → head=assess glued=vitals。
 * 最长匹配优先（"查看" 优先于 "查"）。 */
export function splitHead(raw: string): { head: string; glued: string } {
	const direct = translateCommand(raw);
	if (COMMAND_NAMES.includes(direct)) return { head: raw, glued: "" };

	let best: { head: string; glued: string; len: number } | null = null;
	const low = raw.toLowerCase();
	for (const name of COMMAND_NAMES) {
		if (low.length > name.length && low.startsWith(name)) {
			if (!best || name.length > best.len) {
				best = { head: raw.slice(0, name.length), glued: raw.slice(name.length), len: name.length };
			}
		}
	}
	for (const zh of Object.keys(COMMAND_ALIASES)) {
		if (raw.length > zh.length && raw.startsWith(zh)) {
			if (!best || zh.length > best.len) {
				best = { head: raw.slice(0, zh.length), glued: raw.slice(zh.length), len: zh.length };
			}
		}
	}
	return best ? { head: best.head, glued: best.glued } : { head: raw, glued: "" };
}

export function parseCommand(raw: string): ParseResult {
	const input = raw.trim();
	if (!input.startsWith("/")) {
		return { error: "命令需以 / 开头。输入 /帮助 查看可用命令。" };
	}
	const [headRaw, ...rest] = input.slice(1).split(/\s+/);
	const { head: headToken, glued } = splitHead(headRaw);
	const cmd = translateCommand(headToken);
	// 粘连参数并入后续 token（空格分隔形式不变）。
	const tokens = glued ? [glued, ...rest] : rest;
	const target = tokens.join(" ").toLowerCase() || undefined;

	switch (cmd) {
		case "status":
			return { action: { type: "STATUS" } };
		case "assess":
			return { action: { type: "ASSESS", target: target ? translateTarget(target).toLowerCase() : undefined } };
		case "order":
			return { action: { type: "ORDER", target: target ? translateTarget(target) : undefined } };
		case "view":
			return { action: { type: "VIEW", target: target ? translateTarget(target) : undefined } };
		case "monitor":
			return { action: { type: "MONITOR", target: "vitals" } };
		case "consult":
			return { action: { type: "CONSULT" } };
		case "talk": {
			// 无空格时角色可能粘连在消息前：`/对话患者你现在感觉怎么样`。
			let [whoRaw, ...line] = tokens;
			if (whoRaw) {
				const whoTest = translateTarget(whoRaw).toLowerCase();
				if (whoTest !== "patient" && whoTest !== "family") {
					for (const role of ["患者", "家属", "patient", "family"]) {
						if (whoRaw.startsWith(role)) {
							line = [whoRaw.slice(role.length), ...line];
							whoRaw = role;
							break;
						}
					}
				}
			}
			const who = whoRaw ? translateTarget(whoRaw).toLowerCase() : "";
			if (who !== "patient" && who !== "family") {
				return { error: "对话对象只能是患者（patient）或家属（family）。用法：/对话 患者 你现在感觉怎么样？" };
			}
			return { action: { type: "TALK", target: who, text: line.join(" ") } };
		}
		case "diag":
			return { action: { type: "DIAG", target: tokens.join(" ") } };
		case "give": {
			// /give <药物> [剂量] — dose is free text, preserved verbatim.
			const [drugRaw, ...doseWords] = tokens;
			if (!drugRaw) return { error: "用法：/给药 <药物> [剂量]，如 /给药 吗啡 10。" };
			return {
				action: { type: "GIVE", target: translateTarget(drugRaw).toUpperCase(), text: doseWords.join(" ") || undefined },
			};
		}
		case "report":
			return { action: { type: "REPORT", target: "doctor" } };
		case "wait": {
			// /wait [检查] — optional lab target, generic for any pending lab.
			const [labRaw] = tokens;
			return {
				action: { type: "WAIT", target: labRaw ? translateTarget(labRaw).toUpperCase() : undefined },
			};
		}
		case "history":
			return { action: { type: "HISTORY" } };
		case "hint":
			return { action: { type: "HINT" } };
		case "help":
			return { action: { type: "HELP", target: target ? translateTarget(target).toLowerCase() : undefined } };
		case "pending":
			return { action: { type: "PENDING" } };
		case "case":
			return { action: { type: "CASE", target } };
		default:
			return { error: `未知命令：/${headRaw}。输入 /帮助 查看可用命令。` };
	}
}
