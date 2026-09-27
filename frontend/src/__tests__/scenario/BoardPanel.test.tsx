import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@/__tests__/render";
import type { ScenarioBoard, ScenarioBoardEntry } from "@/api/scenario";
import BoardPanel from "@/scenario/BoardPanel";

function entry(over: Partial<ScenarioBoardEntry> = {}): ScenarioBoardEntry {
	return { id: "e1", kind: "cue", text: "呼叫灯在闪", source: "pack", ...over };
}

function board(over: Partial<ScenarioBoard> = {}): ScenarioBoard {
	return { editable: false, entry_count: 1, sections: [], ...over };
}

/** 板内绝不允许出现的东西：输入控件与编辑按钮。 */
function editableControls(root: HTMLElement): Element[] {
	return [
		...root.querySelectorAll("input, textarea, select, [contenteditable='true']"),
	];
}

describe("线索板：只读事实区", () => {
	it("按版块渲染条目，并给出 data-board-section / data-board-kind / data-entry-id 钩子", () => {
		render(
			<BoardPanel
				board={board({
					entry_count: 3,
					sections: [
						{
							id: "board_scene",
							title: "现场看到的",
							source: "cue",
							more: 0,
							entries: [
								entry({ id: "cue:c1", kind: "cue", text: "A 床的呼叫铃一直在响" }),
								entry({
									id: "noticed:0",
									kind: "noticed",
									text: "B 床监护仪在响，人没出声",
									source: "dm",
								}),
							],
						},
						{
							id: "board_readings",
							title: "读数",
							source: "state",
							more: 0,
							entries: [
								entry({
									id: "state:scene.bed_b_sat",
									kind: "state",
									text: "B 床血氧（%） 88",
									value: 88,
									source: "world",
								}),
							],
						},
					],
				})}
			/>,
		);

		const scene = document.querySelector(
			'[data-board-section="board_scene"]',
		) as HTMLElement;
		expect(scene).not.toBeNull();
		expect(within(scene).getByText("现场看到的")).toBeInTheDocument();
		expect(within(scene).getByText("A 床的呼叫铃一直在响")).toBeInTheDocument();
		expect(within(scene).getByText("B 床监护仪在响，人没出声")).toBeInTheDocument();

		const readings = document.querySelector(
			'[data-board-section="board_readings"]',
		) as HTMLElement;
		expect(within(readings).getByText("B 床血氧（%） 88")).toBeInTheDocument();

		// 钩子：每条都有稳定 id 与类别
		const rows = document.querySelectorAll("[data-entry-id]");
		expect(rows).toHaveLength(3);
		expect(
			document.querySelector('[data-entry-id="state:scene.bed_b_sat"]')?.getAttribute(
				"data-board-kind",
			),
		).toBe("state");
		expect(
			document.querySelector('[data-entry-id="noticed:0"]')?.getAttribute(
				"data-board-kind",
			),
		).toBe("noticed");
	});

	it("板内没有输入控件，也没有编辑按钮（只有展开/收起这类看视图的控件）", () => {
		render(
			<BoardPanel
				board={board({
					entry_count: 9,
					sections: [
						{
							id: "board_done",
							title: "已处置",
							source: "action",
							more: 0,
							entries: Array.from({ length: 9 }, (_, index) =>
								entry({
									id: `action:a${index}`,
									kind: "action",
									text: `动作 ${index}`,
									source: "student",
								}),
							),
						},
					],
				})}
			/>,
		);

		const root = document.querySelector(".sc-board") as HTMLElement;
		expect(editableControls(root)).toHaveLength(0);
		expect(root.querySelector("[contenteditable]")).toBeNull();

		const buttons = [...root.querySelectorAll("button")].map((b) =>
			(b.textContent ?? "").trim(),
		);
		// 只允许"展开其余 N 条 / 收起"这种纯展示控件
		expect(buttons).toEqual(["展开其余 1 条"]);
		for (const name of buttons) {
			expect(name).not.toMatch(/编辑|保存|添加|新建|删除|填写|输入/);
		}
	});

	it("空版块不渲染；整块全空时只给一句空态", () => {
		const { container } = render(
			<BoardPanel
				board={board({
					entry_count: 1,
					sections: [
						{
							id: "board_scene",
							title: "现场看到的",
							source: "cue",
							more: 0,
							entries: [entry({ id: "cue:c1", text: "呼叫灯在闪" })],
						},
						{ id: "board_done", title: "已处置", source: "action", more: 0, entries: [] },
						{ id: "board_notes", title: "线索板", source: "note", more: 0, entries: [] },
					],
				})}
			/>,
		);
		expect(document.querySelector('[data-board-section="board_scene"]')).not.toBeNull();
		expect(document.querySelector('[data-board-section="board_done"]')).toBeNull();
		expect(document.querySelector('[data-board-section="board_notes"]')).toBeNull();
		expect(container.querySelector("[data-empty='true']")).toBeNull();

		const empty = render(<BoardPanel board={board({ entry_count: 0, sections: [] })} />);
		expect(empty.container.querySelector("[data-empty='true']")).not.toBeNull();
		expect(screen.getByText("还没有线索。")).toBeInTheDocument();
	});

	it("superseded 走划线 +「已订正」且旧条目不消失；more>0 给一条如实提示", () => {
		render(
			<BoardPanel
				board={board({
					entry_count: 2,
					sections: [
						{
							id: "board_notes",
							title: "线索板",
							source: "note",
							more: 4,
							entries: [
								entry({
									id: "n1",
									kind: "note",
									text: "先按心梗处理",
									source: "dm",
									superseded: true,
								}),
								entry({
									id: "n2",
									kind: "note",
									text: "改按主动脉夹层处理",
									source: "dm",
									supersedes: "n1",
								}),
							],
						},
					],
				})}
			/>,
		);

		const old = document.querySelector('[data-entry-id="n1"]') as HTMLElement;
		expect(old.getAttribute("data-superseded")).toBe("true");
		expect(within(old).getByText("先按心梗处理")).toBeInTheDocument();
		expect(within(old).getByText("已订正")).toBeInTheDocument();
		// 旧条目仍在（订正不是删除）
		expect(document.querySelector('[data-entry-id="n2"]')).not.toBeNull();
		expect(
			document.querySelector(".sc-board-more-hint")?.textContent,
		).toContain("还有 4 条");
	});

	it("次数：文案已含 ×N 时不再补徽章（同一件事不说两遍），事实证据走次行小字", () => {
		render(
			<BoardPanel
				board={board({
					entry_count: 2,
					sections: [
						{
							id: "board_done",
							title: "已处置",
							source: "action",
							more: 0,
							entries: [
								entry({
									id: "action:a",
									kind: "action",
									text: "给 B 床吸氧 ×3",
									source: "student",
									count: 3,
								}),
								entry({
									id: "action:b",
									kind: "action",
									text: "测 B 床血氧与呼吸",
									source: "student",
									count: 2,
								}),
							],
						},
						{
							id: "board_confirmed",
							title: "已确认的",
							source: "fact",
							more: 0,
							entries: [
								entry({
									id: "fact:f1",
									kind: "fact",
									text: "腹膜刺激征阳性",
									source: "dm",
									evidence: "他说一按就疼得厉害",
								}),
							],
						},
					],
				})}
			/>,
		);

		const withCount = document.querySelector('[data-entry-id="action:a"]') as HTMLElement;
		expect(within(withCount).queryByText("×3")).toBeNull();
		const withoutCount = document.querySelector(
			'[data-entry-id="action:b"]',
		) as HTMLElement;
		expect(within(withoutCount).getByText("×2")).toBeInTheDocument();

		const fact = document.querySelector('[data-entry-id="fact:f1"]') as HTMLElement;
		expect(within(fact).getByText("「他说一按就疼得厉害」")).toBeInTheDocument();
		// 证据是次行小字，不把条目变成两行长文
		expect(fact.querySelector(".sc-board-evidence")?.textContent).toBe(
			"「他说一按就疼得厉害」",
		);
	});

	it("版块长于阈值时默认收起，可展开、可收起", async () => {
		const user = userEvent.setup();
		render(
			<BoardPanel
				board={board({
					entry_count: 9,
					sections: [
						{
							id: "board_scene",
							title: "现场看到的",
							source: "cue",
							more: 0,
							entries: Array.from({ length: 9 }, (_, index) =>
								entry({ id: `cue:${index}`, text: `线索 ${index}` }),
							),
						},
					],
				})}
			/>,
		);

		// 默认收起：只显示前 8 条
		expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(8);
		expect(screen.queryByText("线索 8")).toBeNull();

		const toggle = screen.getByRole("button", { name: "展开其余 1 条" });
		await user.click(toggle);
		expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(9);
		expect(screen.getByText("线索 8")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "收起" }));
		expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(8);
	});
});
