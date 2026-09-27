import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/__tests__/render";
import type { ScenarioAffordance, ScenarioView } from "@/api/scenario";
import ActionBar, {
	type ActionBarProps,
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

/** 输入框是页面持有的受控状态，测试里用一个小 harness 顶上（不假装自己是页面）。 */
function Bar({ view, ...rest }: Partial<ActionBarProps> & { view: ScenarioView }) {
	const [freeText, setFreeText] = useState(rest.freeText ?? "");
	return (
		<ActionBar
			busy={false}
			onSubmit={() => {}}
			onCloseForm={() => {}}
			{...rest}
			view={view}
			freeText={freeText}
			onFreeTextChange={setFreeText}
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

describe("自由表达：输入框是主控件", () => {
	it("常驻一个可增长的多行输入框（rows=2、2000 字上限），发送走 type=ask", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} onSubmit={onSubmit} />);

		const area = freeArea();
		expect(area.tagName).toBe("TEXTAREA");
		expect(area).toHaveAttribute("rows", "2");
		expect(area).toHaveAttribute("maxlength", "2000");
		expect(area).toHaveAttribute("placeholder", "你要做什么？");

		await user.type(area, "给患者吸氧");
		await user.click(screen.getByRole("button", { name: "发送" }));
		expect(onSubmit).toHaveBeenCalledWith({ type: "ask", text: "给患者吸氧" });
	});

	it("Enter 发送；Shift+Enter 换行、不发送（组合键不拦默认行为）", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} onSubmit={onSubmit} />);

		await user.type(freeArea(), "先量个血压");
		await user.keyboard("{Enter}");
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith({ type: "ask", text: "先量个血压" });

		await user.type(freeArea(), "{Shift>}{Enter}{/Shift}");
		expect(onSubmit).toHaveBeenCalledTimes(1);
		// 换行真的进了输入框（没有被自己吞掉）
		expect((freeArea() as HTMLTextAreaElement).value).toContain("\n");
	});

	it("只有空白时发不出去（按钮灰着，Enter 也不送）", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} onSubmit={onSubmit} />);

		expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
		await user.type(freeArea(), "   ");
		await user.keyboard("{Enter}");
		await user.click(screen.getByRole("button", { name: "发送" }));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("free_input=false 的封闭文书型情境连输入行都不给", () => {
		render(<Bar view={makeView({ free_input: false })} />);

		expect(screen.queryByLabelText("你要做什么")).toBeNull();
		expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
		expect(document.querySelector(".sc-actions-row")).toBeNull();
	});

	it("free_input 缺省（undefined）算开着：后端默认就是能自由表达", () => {
		const view = makeView();
		// @ts-expect-error —— 老 pack / 老投影可能压根没这个键，得按"开"处理
		delete view.free_input;

		render(<Bar view={view} />);
		expect(freeArea()).toBeInTheDocument();
	});

	it("busy 时输入框与发送键都停下（回合跑着的时候不许再叠一条）", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Bar view={makeView()} busy onSubmit={onSubmit} freeText="吸痰" />);

		expect(freeArea()).toBeDisabled();
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
		// 表单在前、输入行在后：先回答提示，再自己写
		expect(
			form.compareDocumentPosition(
				document.querySelector(".sc-actions-row") as Node,
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
		await user.type(freeArea(), "再加一床被子");
		await user.click(screen.getByRole("button", { name: "发送" }));

		expect(onSubmit).toHaveBeenCalledWith({ type: "ask", text: "再加一床被子" });
	});
});
