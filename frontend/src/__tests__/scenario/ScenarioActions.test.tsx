import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/__tests__/render";
import type { ScenarioAffordance, ScenarioView } from "@/api/scenario";
import ActionBar, {
	type ActionBarProps,
	CUSTOM_ACTION_LABEL,
	type ScenarioIntent,
	ScenarioOptionStrip,
} from "@/scenario/ActionBar";
import { OTHER_ENTRY_LABEL } from "@/scenario/AffordanceForm";

/**
 * 动作区的两层：
 * - `ScenarioOptionStrip`：气泡流里的 DM 提示（最多 3 条，纯展示，点哪条由页面决定）；
 * - `ActionBar`：常驻的输入框（自由表达是主控件）+ 页面持有的表单。
 *
 * pack 的 `affordances` 列表**不进这个组件**——它不上界面，所以这里也没有它的用例。
 * 流程状态（提示点击、表单开合、二次确认）都在页面里，这里用受控 props 直接驱动。
 */

function affordance(
	overrides: Partial<ScenarioAffordance> & { id: string; label: string },
): ScenarioAffordance {
	return {
		type: "act",
		select: "none",
		options: [],
		fields: [],
		free_input: true,
		confirm: false,
		...overrides,
	};
}

const PICK_SPOT = affordance({
	id: "pick_spot",
	type: "act",
	label: "安排位置",
	select: "single",
	options: ["留观区", "走廊加床"],
});

const WRITE_NOTE = affordance({
	id: "write_note",
	type: "document",
	label: "写分诊记录",
	fields: ["主诉"],
	free_input: false,
});

function makeView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return {
		session: { id: 21, status: "active", turn: 1, lost: false },
		pack: {
			key: "triage-hidden-bleed",
			title: "分诊台上的犹豫",
			player_role: "分诊护士",
			revision_id: 9,
		},
		situation: {
			place: "急诊分诊台",
			time_hint: "19:40",
			resources: [],
			visible_cues: [],
			noticed: [],
		},
		actors: [{ id: "patient", role: "患者", presence: "on_site", present: true }],
		hud: [],
		messages: [{ role: "scene", text: "他自己走进来的。", turn: 1 }],
		options: [],
		affordances: [PICK_SPOT, WRITE_NOTE],
		free_input: true,
		timeline: [],
		dims: [],
		nudges: [],
		problems: [],
		...overrides,
	};
}

/** 输入框与**声明**都是页面持有的受控状态，测试里用一个小 harness 顶上（不假装自己是页面）。 */
function Bar({ view, ...rest }: Partial<ActionBarProps> & { view: ScenarioView }) {
	const [freeText, setFreeText] = useState(rest.freeText ?? "");
	const [intent, setIntent] = useState<ScenarioIntent | null>(rest.intent ?? null);
	return (
		<ActionBar
			busy={false}
			onSubmit={() => {}}
			onCloseForm={() => {}}
			{...rest}
			view={view}
			freeText={freeText}
			onFreeTextChange={setFreeText}
			intent={intent}
			onIntentChange={setIntent}
		/>
	);
}

const freeArea = () => screen.getByLabelText("你要做什么");

describe("DM 提示条：气泡流里最多三条", () => {
	it("渲染提示并把整条 option 交给页面（页面才知道该展开表单还是直接做）", async () => {
		const user = userEvent.setup();
		const onChoose = vi.fn();
		const options = [
			{ label: "听诊双肺", type: "observe", affordance_id: "auscultate", params: {} },
			{ label: "测血氧", type: "measure", affordance_id: "spo2" },
			{ label: "问尿量", type: "ask", affordance_id: "ask_urine" },
		];

		render(
			<ScenarioOptionStrip options={options} busy={false} onChoose={onChoose} />,
		);

		expect(document.querySelectorAll(".sc-option")).toHaveLength(3);
		await user.click(screen.getByRole("button", { name: "测血氧" }));
		expect(onChoose).toHaveBeenCalledWith(options[1]);
	});

	it("模型超产也只给三条：人不是预编程机器人，提示多了就成了菜单", () => {
		render(
			<ScenarioOptionStrip
				options={Array.from({ length: 9 }, (_, index) => ({
					label: `建议 ${index + 1}`,
					type: "act",
					affordance_id: null,
				}))}
				busy={false}
				onChoose={() => {}}
			/>,
		);

		expect(document.querySelectorAll(".sc-option")).toHaveLength(3);
		expect(screen.queryByRole("button", { name: "建议 4" })).toBeNull();
	});

	it("没有提示就什么都不渲染（不留空容器）", () => {
		render(<ScenarioOptionStrip options={[]} busy={false} onChoose={() => {}} />);
		expect(document.querySelector(".sc-options")).toBeNull();
	});

	it("busy 时提示点不动", async () => {
		const user = userEvent.setup();
		const onChoose = vi.fn();
		render(
			<ScenarioOptionStrip
				options={[{ label: "听诊双肺", type: "observe", affordance_id: null }]}
				busy
				onChoose={onChoose}
			/>,
		);

		const button = screen.getByRole("button", { name: "听诊双肺" });
		expect(button).toBeDisabled();
		await user.click(button);
		expect(onChoose).not.toHaveBeenCalled();
	});
});

describe("先声明、再说话：chip 是发送的前提", () => {
	it("在场者与「自定义行动」都做成 chip；搭不上话的人不在这排里", () => {
		render(
			<Bar
				view={makeView({
					actors: [
						{ id: "patient", role: "患者", presence: "on_site", present: true },
						{ id: "doctor", role: "值班医生", presence: "callable", present: false },
						{ id: "behind_glass", role: "隔离间里的病人", presence: "inaccessible", present: false },
					],
				})}
			/>,
		);

		const chips = document.querySelectorAll(".sc-intents .sc-intent");
		// 三名在场者里只有搭得上话的两个 + 「自定义行动」
		expect(chips).toHaveLength(3);
		expect(screen.getByRole("button", { name: /患者/ })).toBeInTheDocument();
		// 提示词沿用在场者条的既有换算（可呼叫 / 搭话）
		expect(screen.getByRole("button", { name: /值班医生\s*可呼叫/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: CUSTOM_ACTION_LABEL })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /隔离间里的病人/ })).toBeNull();
	});

	it("没选声明就发不出去：按钮停着，Enter 也不送", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} onSubmit={onSubmit} />);

		await user.type(freeArea(), "给患者吸氧");
		expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
		await user.keyboard("{Enter}");
		await user.click(screen.getByRole("button", { name: "发送" }));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("「自定义行动」= type=act，不带收信人", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} onSubmit={onSubmit} />);

		await user.click(screen.getByRole("button", { name: CUSTOM_ACTION_LABEL }));
		expect(screen.getByRole("button", { name: CUSTOM_ACTION_LABEL })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await user.type(freeArea(), "给他吸痰");
		await user.click(screen.getByRole("button", { name: "发送" }));
		expect(onSubmit).toHaveBeenCalledWith({ type: "act", text: "给他吸痰" });
	});

	it("对在场者说话 = type=say + 收信人（选了谁就发给谁）", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(
			<Bar
				view={makeView({
					actors: [
						{ id: "patient", role: "患者", presence: "on_site", present: true },
						{ id: "doctor", role: "值班医生", presence: "callable", present: false },
					],
				})}
				onSubmit={onSubmit}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /值班医生/ }));
		await user.type(freeArea(), "你那边能上来一趟吗？");
		await user.click(screen.getByRole("button", { name: "发送" }));
		expect(onSubmit).toHaveBeenCalledWith({
			type: "say",
			text: "你那边能上来一趟吗？",
			target_actor_id: "doctor",
		});
	});

	it("chip 单选：改选另一个在场者时前一个松开", async () => {
		const user = userEvent.setup();
		render(
			<Bar
				view={makeView({
					actors: [
						{ id: "patient", role: "患者", presence: "on_site", present: true },
						{ id: "doctor", role: "值班医生", presence: "callable", present: false },
					],
				})}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /患者/ }));
		await user.click(screen.getByRole("button", { name: /值班医生/ }));

		expect(screen.getByRole("button", { name: /患者/ })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(screen.getByRole("button", { name: /值班医生/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	it("点 chip 只选声明并把焦点送进输入框，不替学生写字", async () => {
		const user = userEvent.setup();
		render(<Bar view={makeView()} />);

		await user.click(screen.getByRole("button", { name: /患者/ }));
		expect(freeArea()).toHaveValue("");
		expect(freeArea()).toHaveFocus();
		expect(document.querySelector(".sc-composer")?.textContent).not.toContain("说：");
	});
});

describe("自由表达：输入框是主控件", () => {
	it("一行起步、2000 字上限，选中声明后回车发送", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} onSubmit={onSubmit} />);

		const area = freeArea();
		expect(area.tagName).toBe("TEXTAREA");
		expect(area).toHaveAttribute("rows", "1");
		expect(area).toHaveAttribute("maxlength", "2000");

		await user.click(screen.getByRole("button", { name: CUSTOM_ACTION_LABEL }));
		await user.type(area, "先量个血压");
		await user.keyboard("{Enter}");
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith({ type: "act", text: "先量个血压" });

		await user.type(freeArea(), "{Shift>}{Enter}{/Shift}");
		expect(onSubmit).toHaveBeenCalledTimes(1);
		// 换行真的进了输入框（没有被自己吞掉）
		expect((freeArea() as HTMLTextAreaElement).value).toContain("\n");
	});

	it("只有空白时发不出去（按钮灰着，Enter 也不送）", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} onSubmit={onSubmit} />);

		await user.click(screen.getByRole("button", { name: CUSTOM_ACTION_LABEL }));
		expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
		await user.type(freeArea(), "   ");
		await user.keyboard("{Enter}");
		await user.click(screen.getByRole("button", { name: "发送" }));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("free_input=false 的封闭文书型情境连输入组都不给", () => {
		render(<Bar view={makeView({ free_input: false })} />);

		expect(screen.queryByLabelText("你要做什么")).toBeNull();
		expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
		expect(document.querySelector(".sc-composer")).toBeNull();
	});

	it("free_input 缺省（undefined）算开着：后端默认就是能自由表达", () => {
		const view = makeView();
		// @ts-expect-error —— 老 pack / 老投影可能压根没这个键，得按"开"处理
		delete view.free_input;

		render(<Bar view={view} />);
		expect(freeArea()).toBeInTheDocument();
	});

	it("busy 时输入框、chip 与发送键都停下（回合跑着的时候不许再叠一条）", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(
			<Bar
				view={makeView()}
				busy
				onSubmit={onSubmit}
				freeText="吸痰"
				intent={{ kind: "act" }}
			/>,
		);

		expect(freeArea()).toBeDisabled();
		expect(screen.getByRole("button", { name: CUSTOM_ACTION_LABEL })).toBeDisabled();
		const send = screen.getByRole("button", { name: "发送" });
		expect(send).toBeDisabled();
		await user.click(send);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("回合落地（focusToken 变化）后焦点回到输入框", () => {
		const { rerender } = render(<Bar view={makeView()} focusToken={1} />);
		expect(document.activeElement).toBe(freeArea());

		rerender(<Bar view={makeView()} focusToken={2} />);
		expect(document.activeElement).toBe(freeArea());
	});

	it("页面给的草稿原样显示（受控，不在组件里另存一份）", () => {
		render(<Bar view={makeView()} freeText="对电话那头的值班医生说：" />);
		expect((freeArea() as HTMLTextAreaElement).value).toBe(
			"对电话那头的值班医生说：",
		);
	});
});

describe("动作表单：只有 DM 提示能把它带出来", () => {
	it("页面没给具体动作时没有表单；给了就渲染在输入行上方，收起回调交给页面", async () => {
		const user = userEvent.setup();
		const onCloseForm = vi.fn();
		const { rerender } = render(
			<Bar view={makeView()} onCloseForm={onCloseForm} />,
		);
		expect(document.querySelector(".sc-form")).toBeNull();

		rerender(
			<Bar
				view={makeView()}
				openAffordance={PICK_SPOT}
				onCloseForm={onCloseForm}
			/>,
		);
		const form = document.querySelector(".sc-form");
		expect(form).not.toBeNull();
		if (form === null) throw new Error("表单没渲染");
		// 表单在前、输入组在后：先回答提示，再自己写
		expect(
			form.compareDocumentPosition(
				document.querySelector(".sc-composer") as Node,
			) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "收起" }));
		expect(onCloseForm).toHaveBeenCalledTimes(1);
	});

	it("记录表单：字段照旧生成，提交载荷不变；抬头是中文分类，不漏英文 type", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(
			<Bar view={makeView()} openAffordance={WRITE_NOTE} onSubmit={onSubmit} />,
		);

		expect(await screen.findByLabelText("主诉")).toBeInTheDocument();
		expect(screen.queryByRole("checkbox", { name: OTHER_ENTRY_LABEL })).toBeNull();
		expect(document.querySelector(".sc-form .sc-btn-tag")).toHaveTextContent("记录");
		expect(screen.queryByText("document")).toBeNull();

		await user.type(screen.getByLabelText("主诉"), "胸痛 20 分钟");
		await user.click(screen.getByRole("button", { name: "就做这件事" }));
		expect(onSubmit).toHaveBeenCalledWith({
			affordance_id: "write_note",
			type: "document",
			text: "主诉：胸痛 20 分钟",
			selected: [],
			custom_text: null,
		});
	});

	it("选择型：「其他」里写的字走 custom_text，不混进 selected", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(
			<Bar view={makeView()} openAffordance={PICK_SPOT} onSubmit={onSubmit} />,
		);

		await user.click(await screen.findByRole("radio", { name: "留观区" }));
		expect(screen.queryByLabelText("自己写")).toBeNull();

		await user.click(screen.getByRole("radio", { name: OTHER_ENTRY_LABEL }));
		await user.type(
			screen.getByLabelText("自己写"),
			"先去挂号台",
		);
		await user.click(screen.getByRole("button", { name: "就做这件事" }));

		expect(onSubmit).toHaveBeenCalledWith({
			affordance_id: "pick_spot",
			type: "act",
			text: null,
			selected: [],
			custom_text: "先去挂号台",
		});
	});

	it("表单与输入框并存：选择型做完还能接着自己写", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(
			<Bar view={makeView()} openAffordance={PICK_SPOT} onSubmit={onSubmit} />,
		);

		await user.click(await screen.findByRole("radio", { name: "走廊加床" }));
		await user.click(screen.getByRole("button", { name: /患者/ }));
		await user.type(freeArea(), "再加一床被子");
		await user.click(screen.getByRole("button", { name: "发送" }));

		expect(onSubmit).toHaveBeenCalledWith({
			type: "say",
			text: "再加一床被子",
			target_actor_id: "patient",
		});
	});
});
