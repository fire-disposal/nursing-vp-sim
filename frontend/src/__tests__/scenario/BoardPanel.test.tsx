import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@/__tests__/render";
import type {
	ScenarioBoard,
	ScenarioBoardEntry,
	ScenarioBoardSection,
} from "@/api/scenario";
import BoardPanel from "@/scenario/BoardPanel";

/**
 * 线索板（`docs/23` §7.5）：**只读、单行、按需具现**的事实区。
 *
 * 板上的内容全由后端投影决定：这一回合没有的版块就是还没有（空版块整块不渲染），
 * 条目已经是压好的一行（前端不再截断/展开），来源（`ref` 可读标签）与来源回合如实标出。
 * 旧的 `note` / `dm` / `superseded` / 编辑入口都不存在了——这里是学生面，不是笔记本。
 */
function entry(over: Partial<ScenarioBoardEntry> = {}): ScenarioBoardEntry {
	return {
		id: "cue:bed_a_call",
		kind: "cue",
		text: "A 床的呼叫铃一直在响",
		source: "pack",
		...over,
	};
}

function section(
	over: Partial<ScenarioBoardSection> & { id: string; source: ScenarioBoardSection["source"] },
): ScenarioBoardSection {
	return { title: "现场看到的", more: 0, entries: [], ...over };
}

function board(over: Partial<ScenarioBoard> = {}): ScenarioBoard {
	return { editable: false, entry_count: 1, sections: [], ...over };
}

const row = (id: string) => document.querySelector(`[data-entry-id="${id}"]`) as HTMLElement;

describe("线索板：只读事实区", () => {
	it("逐条列出事实：条目是压好的一行，空版块整块不渲染", () => {
		const long =
			"患者说昨晚开始胸口一直闷，翻身时更明显，含服硝酸甘油后没有缓解，家属说他刚吃完晚饭";
		render(
			<BoardPanel
				board={board({
					entry_count: 2,
					sections: [
						section({
							id: "board_scene",
							title: "现场看到的",
							source: "cue",
							entries: [
								entry(),
								entry({ id: "cue:bed_b_monitor", text: long }),
							],
						}),
						section({ id: "board_done", title: "已处置", source: "action", entries: [] }),
					],
				})}
			/>,
		);

		const scene = document.querySelector('[data-board-section="board_scene"]') as HTMLElement;
		expect(scene).not.toBeNull();
		expect(within(scene).getByText("A 床的呼叫铃一直在响")).toBeInTheDocument();
		// 单行：整条事实在一个行元素里，不截断、不折成段落
		expect(row("cue:bed_b_monitor").querySelector(".sc-board-line")?.textContent).toBe(long);
		expect(row("cue:bed_a_call").dataset.boardKind).toBe("cue");

		// 这一回合一条都没有的版块：整块不渲染（不留空壳）
		expect(document.querySelector('[data-board-section="board_done"]')).toBeNull();
	});

	it("`more` 只给真实的数量：还有 N 条；没有就不说这一句", () => {
		render(
			<BoardPanel
				board={board({
					entry_count: 2,
					sections: [
						section({
							id: "board_scene",
							source: "cue",
							more: 4,
							entries: [entry()],
						}),
						section({
							id: "board_readings",
							title: "读数",
							source: "state",
							more: 0,
							entries: [entry({ id: "state:bed_b_sat", kind: "state", text: "B 床血氧 88%" })],
						}),
					],
				})}
			/>,
		);

		const scene = document.querySelector('[data-board-section="board_scene"]') as HTMLElement;
		expect(within(scene).getByText("还有 4 条")).toBeInTheDocument();
		const readings = document.querySelector(
			'[data-board-section="board_readings"]',
		) as HTMLElement;
		expect(readings.textContent).not.toContain("还有");
	});

	it("来源如实标出：`ref` 给可读标签，来源回合可点（页面不接就退化成文字）", async () => {
		const user = userEvent.setup();
		const onLocateTurn = vi.fn();
		const props = {
			board: board({
				sections: [
					section({
						id: "board_scene",
						source: "cue",
						entries: [entry({ id: "cue:c1", ref: "cue:bed_b_call", turn: 2 })],
					}),
				],
			}),
		};

		const clickable = render(<BoardPanel {...props} onLocateTurn={onLocateTurn} />);
		expect(screen.getByText("线索 bed_b_call")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "时间单位 2" }));
		expect(onLocateTurn).toHaveBeenCalledWith(2);
		clickable.unmount();

		render(<BoardPanel {...props} />);
		expect(screen.getByText("时间单位 2")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "时间单位 2" })).toBeNull();
	});

	it("整块全空时只给一句空态，不给一张空板", () => {
		const { container } = render(<BoardPanel board={board({ entry_count: 0, sections: [] })} />);
		expect(container.querySelector("[data-empty='true']")).not.toBeNull();
		expect(screen.getByText("还没有线索。")).toBeInTheDocument();
	});

	it("长版块默认收起，可展开、可收起", async () => {
		const user = userEvent.setup();
		render(
			<BoardPanel
				board={board({
					entry_count: 9,
					sections: [
						section({
							id: "board_scene",
							source: "cue",
							entries: Array.from({ length: 9 }, (_, index) =>
								entry({ id: `cue:${index}`, text: `线索 ${index}` }),
							),
						}),
					],
				})}
			/>,
		);

		expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(8);
		expect(screen.queryByText("线索 8")).toBeNull();

		const moreButton = screen.getByRole("button", { name: "展开其余 1 条" });
		expect(moreButton).toHaveAttribute("aria-expanded", "false");
		await user.click(moreButton);
		expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(9);
		expect(screen.getByText("线索 8")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "收起" }));
		expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(8);
	});

	it("板内没有任何写入口：能点的只有展开／收起这种看视图的控件", () => {
		render(
			<BoardPanel
				board={board({
					entry_count: 9,
					sections: [
						section({
							id: "board_done",
							title: "已处置",
							source: "action",
							entries: Array.from({ length: 9 }, (_, index) =>
								entry({ id: `action:a${index}`, kind: "action", text: `给 B 床吸氧 ${index}` }),
							),
						}),
					],
				})}
			/>,
		);

		const root = document.querySelector(".sc-board") as HTMLElement;
		expect(root.querySelectorAll("input, textarea, select, [contenteditable]")).toHaveLength(0);
		const names = [...root.querySelectorAll("button")].map((button) =>
			(button.textContent ?? "").trim(),
		);
		expect(names).toEqual(["展开其余 1 条"]);
	});

	it("同一件事不说两遍：文案已含 ×N 就不再补徽章，证据走次行小字", () => {
		render(
			<BoardPanel
				board={board({
					entry_count: 2,
					sections: [
						section({
							id: "board_done",
							title: "已处置",
							source: "action",
							entries: [
								entry({ id: "action:a", kind: "action", text: "给 B 床吸氧 ×3", count: 3 }),
								entry({ id: "action:b", kind: "action", text: "测 B 床血氧与呼吸", count: 2 }),
							],
						}),
						section({
							id: "board_confirmed",
							title: "已确认的",
							source: "fact",
							entries: [
								entry({
									id: "fact:f1",
									kind: "fact",
									text: "腹膜刺激征阳性",
									evidence: "他说一按就疼得厉害",
								}),
							],
						}),
					],
				})}
			/>,
		);

		// 文案已经说了三次，就不要再挂一个 ×3
		expect(within(row("action:a")).queryByText("×3")).toBeNull();
		expect(within(row("action:b")).getByText("×2")).toBeInTheDocument();

		const fact = row("fact:f1");
		expect(fact.querySelector(".sc-board-evidence")?.textContent).toBe("「他说一按就疼得厉害」");
		expect(fact.querySelector(".sc-board-line")?.textContent).toBe("腹膜刺激征阳性");
	});

	it("只有事实的词汇：条目类别不出枚举，界面不出现 note / dm 这类内部说法", () => {
		const kinds = ["cue", "state", "noticed", "fact", "action"] as const;
		const { container } = render(
			<BoardPanel
				board={board({
					entry_count: kinds.length,
					sections: kinds.map((kind) =>
						section({
							id: `board_${kind}`,
							title: `版块 ${kind}`,
							source: kind,
							entries: [entry({ id: `${kind}:1`, kind, text: `一条 ${kind}` })],
						}),
					),
				})}
			/>,
		);

		const shown = [...container.querySelectorAll("[data-board-kind]")].map(
			(element) => (element as HTMLElement).dataset.boardKind,
		);
		expect(shown).toEqual([...kinds]);
		expect(container.textContent).not.toMatch(/\b(note|dm)\b/i);
		expect(container.querySelector("[data-superseded]")).toBeNull();
	});
});
