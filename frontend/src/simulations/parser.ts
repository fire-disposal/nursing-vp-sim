/** Slash-command parser — the React adapter that turns text into structured
 * actions (MVP-B §3.3). The engine only ever receives structured actions.
 *
 * The parser is deliberately thin on target validation: for the lab / assess
 * commands it passes the raw target through to the backend, which answers with
 * the full list of available options and their status (cost, turnaround,
 * pending, budget) printed inline — the console never pops a modal for a typo.
 *
 * 中文触发词：命令头与参数经 aliases.ts 翻译为后端英文 key，便于记忆。
 */

import { translateCommand, translateTarget } from "./aliases";

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
	| "PENDING"
	| "CASE";

export interface ParsedAction {
	type: SimActionType;
	target?: string;
	text?: string;
}

export type ParseResult = { action: ParsedAction } | { error: string };

export function parseCommand(raw: string): ParseResult {
	const input = raw.trim();
	if (!input.startsWith("/")) {
		return { error: "命令需以 / 开头。输入 /帮助 查看可用命令。" };
	}
	const [headRaw, ...rest] = input.slice(1).split(/\s+/);
	const cmd = translateCommand(headRaw);
	const target = rest.join(" ").toLowerCase() || undefined;

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
			const [whoRaw, ...line] = rest;
			const target = whoRaw ? translateTarget(whoRaw).toLowerCase() : "";
			if (target !== "patient" && target !== "family") {
				return { error: "对话对象只能是患者（patient）或家属（family）。用法：/对话 患者 你现在感觉怎么样？" };
			}
			return { action: { type: "TALK", target, text: line.join(" ") } };
		}
		case "diag":
			return { action: { type: "DIAG", target: rest.join(" ") } };
		case "give": {
			// /give <药物> [剂量] — dose is free text, preserved verbatim.
			const [drugRaw, ...doseWords] = rest;
			if (!drugRaw) return { error: "用法：/给药 <药物> [剂量]，如 /给药 吗啡 10。" };
			return {
				action: { type: "GIVE", target: translateTarget(drugRaw).toUpperCase(), text: doseWords.join(" ") || undefined },
			};
		}
		case "report":
			return { action: { type: "REPORT", target: "doctor" } };
		case "wait": {
			// /wait [检查] — optional lab target, generic for any pending lab.
			const [labRaw] = rest;
			return {
				action: { type: "WAIT", target: labRaw ? translateTarget(labRaw).toUpperCase() : undefined },
			};
		}
		case "history":
			return { action: { type: "HISTORY" } };
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
