/** Autocomplete derivation — pure function mapping the current input to
 * GROUPED suggestions (mirroring the backend help groups), so the panel can
 * render folded groups instead of a flat list.
 *
 * Rules:
 * - input not starting with "/" → no suggestions.
 * - a command with sub-targets (assess/order/view/…) fully typed → drill into
 *   its parameters, prefix-matched on what follows.
 * - otherwise → group the prefix-matching commands by the backend help group;
 *   an exact full-command match hides the panel (ArrowUp/Down then walk
 *   history like a real shell).
 */

import { COMMAND_GROUPS, COMMANDS, type CommandDef, type Completion } from "./commands";

export interface CompletionGroup {
	name: string;
	desc: string;
	items: Completion[];
}

export function computeCompletionGroups(raw: string): CompletionGroup[] {
	const input = raw.trimStart();
	if (!input.startsWith("/")) return [];

	const rest = input.slice(1);
	const [headRaw, ...tailRaw] = rest.split(/\s+/);
	const head = headRaw.toLowerCase();
	const param = tailRaw.join(" ").toLowerCase();

	const drill = COMMANDS.find((c) => c.cmd === head && c.params);
	if (drill) {
		const items = (drill.params ?? [])
			.filter((p) => p.startsWith(param) && p !== param)
			.map((p) => toCompletion(drill, p));
		return items.length ? [{ name: drill.cmd, desc: drill.desc, items }] : [];
	}

	return COMMAND_GROUPS.map((g) => ({
		name: g.name,
		desc: g.desc,
		items: g.commands
			.filter((c) => c.cmd.startsWith(head) && `/${c.cmd}` !== input.trim())
			.map((c) => toCompletion(c)),
	})).filter((g) => g.items.length > 0);
}

function toCompletion(cmd: CommandDef, param?: string): Completion {
	if (param) {
		return {
			text: `/${cmd.cmd} ${param}`,
			label: `/${cmd.cmd} ${param}`,
			desc: cmd.paramDesc?.[param] ?? cmd.desc,
		};
	}
	return {
		text: `/${cmd.cmd}`,
		label: `/${cmd.cmd}`,
		desc: cmd.desc,
	};
}
