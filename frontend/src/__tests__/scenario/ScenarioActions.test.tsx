import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/__tests__/render";
import type {
	ScenarioActionInput,
	ScenarioAffordance,
	ScenarioDevice,
	ScenarioView,
} from "@/api/scenario";
import ActionBar, { type ActionBarProps, type ScenarioIntent } from "@/scenario/ActionBar";
import { OTHER_ENTRY_LABEL } from "@/scenario/AffordanceForm";
import { makeAffordance, makeView } from "./fixtures";
import { chooseMode, chooseTarget, submitLine } from "./intent";

/**
 * 输入区（`docs/scenario.md` §7.4）：**先选对象，再表达**。
 *
 * 学生看到的是「说话 / 行动」两个文字按钮 + 一个对象下拉 + 一句话输入框；
 * 提交形状是后端契约（`kind` / `target` / `selection` / `text`），这里只钉**学生的操作**
 * 与**送出去的载荷**，不钉内部实现（没有 chip、没有 `options`、没有「自定义行动」这一类
 * 中间态；那些已经不存在了）。
 *
 * 草稿与对象是**页面**持有的受控状态（`ScenarioConsole` 持有），这里用一个小 harness 顶上：
 * 它只做「存住草稿与意图」，不替组件做任何决定。
 */
function Composer({
	view,
	intent: initialIntent,
	...rest
}: Partial<ActionBarProps> & { view: ScenarioView }) {
	const [freeText, setFreeText] = useState(rest.freeText ?? "");
	const [intent, setIntent] = useState<ScenarioIntent>(
		initialIntent ?? { kind: "speech", target: null },
	);
	return (
		<ActionBar
			{...rest}
			view={view}
			busy={rest.busy ?? false}
			freeText={freeText}
			onFreeTextChange={setFreeText}
			intent={intent}
			onIntentChange={setIntent}
			onSubmit={rest.onSubmit ?? (() => {})}
			onCloseForm={rest.onCloseForm ?? (() => {})}
			onOpenForm={rest.onOpenForm ?? (() => {})}
			onHint={rest.onHint ?? (() => {})}
		/>
	);
}

/** 设备本身在设备面测（`DevicePanel.test.tsx`）；这里只要它作为一个可选对象露面。 */
const MONITOR: ScenarioDevice = {
	id: "monitor_b",
	kind: "monitor",
	title: "B 床监护仪",
	sound: "off",
	channels: [],
};

const objectSelect = () =>
	screen.getByLabelText("当前对象（说话或行动的对象）") as HTMLSelectElement;
const draft = () =>
	screen.getByRole("textbox", { name: /你要说的话|要尝试的行动/ }) as HTMLTextAreaElement;
const send = () => screen.getByRole("button", { name: "发送" });

/** 两名可接触的在场者（`makeView` 默认）→ 对象必须由学生自己选。 */
const TWO_BEDS = makeView();
/** 只有一名可接触的在场者 → 平台自己选中他，不逼学生再点一次。 */
const ONE_BED = makeView({
	actors: [
		{ id: "patient", role: "2 床患者", presence: "on_site", present: true, contactable: true },
		{ id: "away", role: "值班医生", presence: "inaccessible", present: false, contactable: false },
	],
});

describe("输入区：模式与对象", () => {
	it("「说话」「行动」是带文字的按钮，pressed 状态跟着当前模式", async () => {
		const user = userEvent.setup();
		render(<Composer view={TWO_BEDS} />);

		const speech = screen.getByRole("button", { name: "说话" });
		const action = screen.getByRole("button", { name: "行动" });
		expect(speech).toHaveAttribute("aria-pressed", "true");
		expect(action).toHaveAttribute("aria-pressed", "false");

		await chooseMode(user, "行动");
		expect(screen.getByRole("button", { name: "行动" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("button", { name: "说话" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("对象下拉列的是可读名字：接触得到的在场者；行动时再加设备与场景", async () => {
		const user = userEvent.setup();
		render(<Composer view={makeView({ devices: [MONITOR] })} />);

		expect(screen.getByRole("option", { name: "2 床患者" })).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "3 床患者" })).toBeInTheDocument();
		// 看得见的人（在场者条）不等于能被当成目标的人：不可接触的人不进下拉
		expect(screen.queryByRole("option", { name: "值班医生" })).toBeNull();
		// 内部 id 不上界面
		expect(screen.queryByRole("option", { name: "patient" })).toBeNull();
		// 说话说不给设备
		expect(screen.queryByRole("option", { name: "B 床监护仪" })).toBeNull();

		await chooseMode(user, "行动");
		expect(screen.getByRole("option", { name: "B 床监护仪" })).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "当前场景" })).toBeInTheDocument();
	});

	it("两个以上可接触对象时先不猜：草稿写好了也发不出去，选了对象才发", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Composer view={TWO_BEDS} onSubmit={onSubmit} />);

		expect(objectSelect()).toHaveValue("");
		await user.type(draft(), "先量个血压");
		expect(send()).toBeDisabled();
		fireEvent.keyDown(draft(), { key: "Enter" });
		await user.click(send());
		expect(onSubmit).not.toHaveBeenCalled();

		await chooseTarget(user, "2 床患者");
		expect(send()).toBeEnabled();
		await user.click(send());
		expect(onSubmit).toHaveBeenCalledWith({
			kind: "speech",
			target: { kind: "actor", id: "patient" },
			text: "先量个血压",
			selection: [],
		});
	});

	it("只有一个可接触对象时自动选中他：不用再点一次，写一句话就能发", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Composer view={ONE_BED} onSubmit={onSubmit} />);

		expect(objectSelect()).toHaveValue("actor:patient");

		await submitLine(user, "你现在感觉怎么样？");
		expect(onSubmit).toHaveBeenCalledWith({
			kind: "speech",
			target: { kind: "actor", id: "patient" },
			text: "你现在感觉怎么样？",
			selection: [],
		});
	});

	it("切模式、换对象都不丢草稿；换回说话仍对着同一个人", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Composer view={TWO_BEDS} onSubmit={onSubmit} />);

		await user.type(draft(), "给他吸氧");
		await chooseTarget(user, "2 床患者");
		await chooseMode(user, "行动");
		expect(draft()).toHaveValue("给他吸氧");
		expect(objectSelect()).toHaveValue("actor:patient");

		await chooseTarget(user, "3 床患者");
		expect(draft()).toHaveValue("给他吸氧");
		await chooseMode(user, "说话");
		expect(draft()).toHaveValue("给他吸氧");
		// 切模式不静默换人：还是学生自己选的那一个
		expect(objectSelect()).toHaveValue("actor:other");

		await user.click(send());
		expect(onSubmit).toHaveBeenCalledWith({
			kind: "speech",
			target: { kind: "actor", id: "other" },
			text: "给他吸氧",
			selection: [],
		});
	});

	it("对象离场后如实标「已不可达」并拦住发送，绝不静默换人", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		const { rerender } = render(<Composer view={TWO_BEDS} onSubmit={onSubmit} />);

		await chooseTarget(user, "2 床患者");
		await user.type(draft(), "帮他翻个身");
		expect(send()).toBeEnabled();

		// 2 床走了，只剩 3 床
		rerender(
			<Composer
				view={makeView({
					actors: [
						{ id: "patient", role: "2 床患者", presence: "left", present: false, contactable: false },
						{ id: "other", role: "3 床患者", presence: "on_site", present: true, contactable: true },
					],
				})}
				onSubmit={onSubmit}
			/>,
		);

		expect(
			screen.getByRole("option", { name: "2 床患者（已不可达）" }),
		).toBeInTheDocument();
		expect(objectSelect()).toHaveValue("actor:patient");
		expect(send()).toBeDisabled();
		fireEvent.keyDown(draft(), { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("草稿只有空白时发不出去（按钮灰着，Enter 也不送）", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Composer view={ONE_BED} onSubmit={onSubmit} />);

		expect(send()).toBeDisabled();
		await user.type(draft(), "   ");
		expect(send()).toBeDisabled();
		fireEvent.keyDown(draft(), { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe("输入区：Enter 与提示", () => {
	it("中文输入法合成期间 Enter 不发送；合成结束后 Enter 才发", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Composer view={ONE_BED} onSubmit={onSubmit} />);

		await user.type(draft(), "我看看");
		const area = draft();
		fireEvent.compositionStart(area);
		fireEvent.keyDown(area, { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.compositionEnd(area);
		fireEvent.keyDown(area, { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith({
			kind: "speech",
			target: { kind: "actor", id: "patient" },
			text: "我看看",
			selection: [],
		});
	});

	it("Shift+Enter 换行而不是发送", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Composer view={ONE_BED} onSubmit={onSubmit} />);

		await user.type(draft(), "第一行");
		await user.type(draft(), "{Shift>}{Enter}{/Shift}");
		expect(onSubmit).not.toHaveBeenCalled();
		expect(draft().value).toContain("\n");
	});

	it("「给我一点提示」只请求提示，不提交任何处置、也不动草稿", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		const onHint = vi.fn();
		render(<Composer view={ONE_BED} onSubmit={onSubmit} onHint={onHint} />);

		await user.type(draft(), "我觉得该吸痰");
		await user.click(screen.getByRole("button", { name: "给我一点提示" }));

		expect(onHint).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(draft()).toHaveValue("我觉得该吸痰");
	});

	it("声明过的记录／选择型动作走显式入口；没有这类动作就不给入口", async () => {
		const user = userEvent.setup();
		const onOpenForm = vi.fn();
		const DOCUMENT = makeAffordance({
			id: "write_note",
			type: "document",
			label: "写分诊记录",
			fields: ["主诉"],
			free_input: false,
		});
		const view = makeView({ affordances: [DOCUMENT] });

		const plain = render(<Composer view={TWO_BEDS} onOpenForm={onOpenForm} />);
		expect(screen.queryByRole("button", { name: "记录／选择" })).toBeNull();
		plain.unmount();

		render(<Composer view={view} onOpenForm={onOpenForm} />);
		await user.click(screen.getByRole("button", { name: "记录／选择" }));
		await user.click(screen.getByRole("button", { name: "写分诊记录" }));
		expect(onOpenForm).toHaveBeenCalledWith("write_note");
	});
});

describe("动作表单：选项只发 id，自己写的字进 text", () => {
	const PLACE = makeAffordance({
		id: "pick_spot",
		type: "act",
		label: "安排位置",
		select: "single",
		options: [
			{ id: "ward", label: "留观区" },
			{ id: "corridor", label: "走廊加床" },
		],
	});
	const TARGET = { kind: "actor" as const, id: "patient" };

	it("列出声明的选项与对象；选一项就送该项的 id", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn<(action: ScenarioActionInput) => void>();
		render(
			<Composer
				view={makeView({ affordances: [PLACE] })}
				intent={{ kind: "action", target: TARGET }}
				openAffordance={PLACE}
				onSubmit={onSubmit}
			/>,
		);

		// 学生看见的是标签（对象也一直看得见），内部 id 不上界面
		expect(screen.getByRole("radio", { name: "留观区" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "走廊加床" })).toBeInTheDocument();
		expect(screen.queryByText("corridor")).toBeNull();
		// 动作的对象在表单里一直看得见（不被表单盖住）
		expect(document.querySelector(".sc-form-target")?.textContent).toContain("2 床患者");

		await user.click(screen.getByRole("radio", { name: "走廊加床" }));
		await user.click(screen.getByRole("button", { name: "就做这件事" }));

		expect(onSubmit).toHaveBeenCalledWith({
			kind: "action",
			target: TARGET,
			affordance_id: "pick_spot",
			selection: ["corridor"],
			text: null,
		});
	});

	it("选「其他」时：selection 为空，自己写的字进 text", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(
			<Composer
				view={makeView({ affordances: [PLACE] })}
				intent={{ kind: "action", target: TARGET }}
				openAffordance={PLACE}
				onSubmit={onSubmit}
			/>,
		);

		await user.click(screen.getByRole("radio", { name: OTHER_ENTRY_LABEL }));
		await user.type(screen.getByLabelText("自己写"), "先去挂号台");
		await user.click(screen.getByRole("button", { name: "就做这件事" }));

		expect(onSubmit).toHaveBeenCalledWith({
			kind: "action",
			target: TARGET,
			affordance_id: "pick_spot",
			selection: [],
			text: "先去挂号台",
		});
	});

	it("记录表单：各字段按行拼成纯文本进 text，封闭文书不给「其他」", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		const NOTE = makeAffordance({
			id: "write_note",
			type: "document",
			label: "写分诊记录",
			fields: ["主诉", "意识"],
			free_input: false,
		});
		render(
			<Composer
				view={makeView({ affordances: [NOTE] })}
				intent={{ kind: "action", target: TARGET }}
				openAffordance={NOTE}
				onSubmit={onSubmit}
			/>,
		);

		expect(screen.queryByRole("checkbox", { name: OTHER_ENTRY_LABEL })).toBeNull();
		// 抬头给学生看的是中文分类，不漏内部英文 type
		expect(document.querySelector(".sc-form .sc-btn-tag")?.textContent).not.toMatch(/[A-Za-z]/);
		expect(screen.queryByText("document")).toBeNull();

		await user.type(screen.getByLabelText("主诉"), "胸痛 20 分钟");
		await user.type(screen.getByLabelText("意识"), "清楚");
		await user.click(screen.getByRole("button", { name: "就做这件事" }));

		expect(onSubmit).toHaveBeenCalledWith({
			kind: "action",
			target: TARGET,
			affordance_id: "write_note",
			selection: [],
			text: "主诉：胸痛 20 分钟\n意识：清楚",
		});
	});

	it("表单与输入框并存：表单开着的时候自由表达照样在", () => {
		render(
			<Composer
				view={makeView({ affordances: [PLACE] })}
				intent={{ kind: "action", target: TARGET }}
				openAffordance={PLACE}
			/>,
		);

		expect(document.querySelector(".sc-form")).not.toBeNull();
		expect(draft()).toBeInTheDocument();
		expect(send()).toBeInTheDocument();
	});
});

/**
 * 耗时标记（`docs/scenario.md` §7.4）：`time_cost` 是**包声明的世界事实**，不是评分。学生有权在点开
 * 之前就看出哪一步会让时间前进；这里只钉「标没标」，不钉数字（界面不报数字、不给单位、
 * 不做倒计时——那属于学生不该看见的记分板）。
 */
describe("动作表单：耗时动作标出「耗时」", () => {
	const shape = {
		id: "reposition",
		type: "act",
		label: "协助翻身",
		select: "single",
		options: [{ id: "left", label: "向左侧卧" }],
	};

	/** 声明了耗时的动作（`time_cost` 是显式字段）。 */
	const costly = makeAffordance({ ...shape, time_cost: 2 });
	/** 不耗时的两种写法：显式写 0，以及整条字段缺省（老包/未投影）。 */
	const freeWithZero = makeAffordance({ ...shape, time_cost: 0 });
	const freeWithoutField = makeAffordance({ ...shape });
	const TARGET = { kind: "actor" as const, id: "patient" };

	it("声明耗时的动作：入口列表与表单抬头都带「耗时」", async () => {
		const user = userEvent.setup();
		render(
			<Composer
				view={makeView({ affordances: [costly] })}
				intent={{ kind: "action", target: TARGET }}
				openAffordance={costly}
			/>,
		);

		// 表单抬头：「对象：…」这一行标出这一步会花时间
		const head = document.querySelector(".sc-form-target") as HTMLElement;
		expect(head.textContent).toContain("2 床患者");
		expect(head.querySelector(".sc-time-cost")?.textContent).toBe("耗时");

		// 「记录／选择」入口列表里也一样：点开前就能看出来
		await user.click(screen.getByRole("button", { name: "记录／选择" }));
		const entry = screen.getByRole("button", { name: /协助翻身/ });
		expect(entry.querySelector(".sc-time-cost")?.textContent).toBe("耗时");
		expect(entry.textContent).toBe("协助翻身耗时");
	});

	it("不耗时的动作（0 或字段缺省）任何地方都不标", async () => {
		const user = userEvent.setup();
		for (const free of [freeWithZero, freeWithoutField]) {
			const { unmount } = render(
				<Composer
					view={makeView({ affordances: [free] })}
					intent={{ kind: "action", target: TARGET }}
					openAffordance={free}
				/>,
			);

			// 表单开着：抬头没有标记
			expect(document.querySelector(".sc-form")).not.toBeNull();
			expect(document.querySelector(".sc-time-cost")).toBeNull();

			// 入口列表也没有
			await user.click(screen.getByRole("button", { name: "记录／选择" }));
			expect(document.querySelector(".sc-options")).not.toBeNull();
			expect(screen.queryByText("耗时")).toBeNull();
			unmount();
		}
	});
});

/**
 * 对象「是不是发送必需」的冻结口径（2026-09-29，`docs/scenario.md` §7.4）：
 * - `action`：由动作自己声明的 `targets` 决定绑定；`targets` 为空 = **不需要对象**，
 *   前端**不得**因为"没选对象"拦住一次尝试（平台按动作判定/后端澄清）。
 * - `speech`：场景里**有可搭话的人**才要求收信人；一个人都搭不上话时给一句人话说明，
 *   而不是让发送键无声地死掉。**任何禁用都必须能说出为什么**（`role="status"`）。
 * 这里只钉**学生的操作**与**送出去的载荷**，不钉内部实现。
 */
describe("输入区：对象不是处处必需（冻结口径）", () => {
	/** 控制台那样把「记录／选择」的入口接到展开动作上（Composer 自身不做这件事）。 */
	function Console({
		view,
		intent,
		onSubmit,
	}: {
		view: ScenarioView;
		intent?: ScenarioIntent;
		onSubmit?: (action: ScenarioActionInput) => void;
	}) {
		const [open, setOpen] = useState<ScenarioAffordance | null>(null);
		return (
			<Composer
				view={view}
				intent={intent}
				openAffordance={open}
				onOpenForm={(id) =>
					setOpen(view.affordances?.find((item) => item.id === id) ?? null)
				}
				onCloseForm={() => setOpen(null)}
				onSubmit={onSubmit}
			/>
		);
	}

	it("空 targets 的动作不要求对象：没选对象也能发，载荷 target 是 null", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		// pack 未声明 targets（空）→ 平台按动作判定，学生不必先点对象
		const NOTE = makeAffordance({
			id: "write_note",
			type: "document",
			label: "写分诊记录",
			fields: ["主诉"],
			free_input: false,
			targets: [],
		});
		render(
			<Console
				view={makeView({ affordances: [NOTE] })}
				intent={{ kind: "action", target: null }}
				onSubmit={onSubmit}
			/>,
		);

		// 学生的路径：打开「记录／选择」→ 点开这条动作
		await user.click(screen.getByRole("button", { name: "记录／选择" }));
		await user.click(screen.getByRole("button", { name: "写分诊记录" }));

		// 一个对象都没选，也没有任何抱怨——空 targets 不要求对象
		expect(objectSelect()).toHaveValue("");
		expect(screen.queryByRole("status")).toBeNull();

		await user.type(draft(), "患者主诉胸痛");
		expect(send()).toBeEnabled();
		await user.click(send());

		expect(onSubmit).toHaveBeenCalledWith({
			kind: "action",
			target: null,
			text: "患者主诉胸痛",
			selection: [],
		});
	});

	it("动作声明多个 targets 而一个都没选：发得出去（target 是 null），交由后端澄清", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		// 动作自己声明了两个绑定目标：绑谁由后端澄清，前端不替学生冻结
		const TWO_TARGETS = makeAffordance({
			id: "compare_pupils",
			type: "observe",
			label: "对比双侧瞳孔",
			select: "single",
			options: [{ id: "equal", label: "等大等圆" }],
			targets: [
				{ kind: "actor", id: "patient" },
				{ kind: "actor", id: "other" },
			],
		});
		render(
			<Composer
				view={makeView({ affordances: [TWO_TARGETS] })}
				intent={{ kind: "action", target: null }}
				openAffordance={TWO_TARGETS}
				onSubmit={onSubmit}
			/>,
		);

		expect(objectSelect()).toHaveValue("");
		await user.type(draft(), "看一下瞳孔");
		expect(send()).toBeEnabled();
		await user.click(send());

		expect(onSubmit).toHaveBeenCalledWith({
			kind: "action",
			target: null,
			text: "看一下瞳孔",
			selection: [],
		});
	});

	it("场景里没人能搭话时，说话发不出去但会说明「此刻没有人可以对话。」", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		// 所有在场者都不可接触：说话没有收信人这回事，但学生必须看得见为什么
		const view = makeView({
			actors: [
				{ id: "patient", role: "2 床患者", presence: "left", present: false, contactable: false },
				{ id: "away", role: "值班医生", presence: "inaccessible", present: false, contactable: false },
			],
		});
		render(<Composer view={view} onSubmit={onSubmit} />);

		// 默认就是「说话」；没人可选时占位仍是「请选择收信人」
		expect(objectSelect()).toHaveValue("");
		await user.type(draft(), "有人吗？");
		expect(send()).toBeDisabled();
		expect(screen.queryByRole("status")).toHaveTextContent("此刻没有人可以对话。");

		fireEvent.keyDown(draft(), { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("有人能搭话但还没选收信人时，说明「先选一个收信人，再发送。」", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<Composer view={TWO_BEDS} onSubmit={onSubmit} />);

		await user.type(draft(), "先量个血压");
		expect(send()).toBeDisabled();
		expect(screen.queryByRole("status")).toHaveTextContent("先选一个收信人，再发送。");

		await chooseTarget(user, "2 床患者");
		expect(send()).toBeEnabled();
		expect(screen.queryByRole("status")).toBeNull();
	});
});
