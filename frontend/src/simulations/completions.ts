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

import { EN_TO_ZH, translateCommand } from "./aliases";
import { buildCommandGroups, type CommandDef, type CommandSurface, type Completion } from "./commands";

export interface CompletionGroup {
	name: string;
	desc: string;
	items: Completion[];
}

export function computeCompletionGroups(raw: string, surface?: CommandSurface): CompletionGroup[] {
	const input = raw.trimStart();
	if (!input.startsWith("/")) return [];

	const groups = buildCommandGroups(surface);
	const commands = groups.flatMap((g) => g.commands);

	const rest = input.slice(1);
	const [headRaw, ...tailRaw] = rest.split(/\s+/);
	const head = translateCommand(headRaw);
	const param = tailRaw.join(" ").toLowerCase();

	const drill = commands.find((c) => c.cmd === head && c.params);
	if (drill) {
		const items = (drill.params ?? [])
			.filter((p) => {
				const pz = EN_TO_ZH[p] ?? EN_TO_ZH[p.toUpperCase()] ?? p;
				const match = p.toLowerCase().startsWith(param) || pz.startsWith(param);
				return match && p.toLowerCase() !== param && pz !== param;
			})
			.map((p) => toCompletion(drill, p));
		return items.length ? [{ name: drill.cmd, desc: drill.desc, items }] : [];
	}

	return groups
		.map((g) => ({
			name: g.name,
			desc: g.desc,
			items: g.commands
				.filter(
					(c) =>
						(c.cmd.startsWith(head) || c.zh.startsWith(headRaw)) &&
						`/${c.cmd}` !== input.trim() &&
						`/${c.zh}` !== input.trim(),
				)
				.map((c) => toCompletion(c)),
		}))
		.filter((g) => g.items.length > 0);
}

function toCompletion(cmd: CommandDef, param?: string): Completion {
	const zh = cmd.zh ?? cmd.cmd;
	if (param) {
		const paramZh = EN_TO_ZH[param] ?? EN_TO_ZH[param.toUpperCase()] ?? param;
		return {
			text: `/${zh} ${paramZh}`,
			label: `/${zh} ${paramZh}`,
			desc: cmd.paramDesc?.[param] ?? cmd.desc,
		};
	}
	return {
		text: `/${zh}`,
		label: `/${zh}`,
		desc: cmd.desc,
	};
}
