import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioBoard, ScenarioView } from "@/api/scenario";
import { STUDENT_FALLBACK_NOTICE } from "@/scenario/problems";
import ScenarioConsole from "@/scenario/ScenarioConsole";
import { startPack } from "./entry";
import { chooseCustomAction } from "./intent";

const mocks = vi.hoisted(() => ({
	listScenarioPacks: vi.fn(),
	listMyScenarioSessions: vi.fn(),
	createScenarioSession: vi.fn(),
	getScenarioSession: vi.fn(),
	postScenarioAction: vi.fn(),
	closeScenarioSession: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"@/api/scenario",
	);
	return {
		...actual,
		listScenarioPacks: mocks.listScenarioPacks,
		listMyScenarioSessions: mocks.listMyScenarioSessions,
		createScenarioSession: mocks.createScenarioSession,
		getScenarioSession: mocks.getScenarioSession,
		postScenarioAction: mocks.postScenarioAction,
		closeScenarioSession: mocks.closeScenarioSession,
	};
});

const PACK = {
	key: "night-call-decision",
	title: "夜里被叫起来",
	state: "experimental",
	one_line: "夜班值班，三条线同时响。",
	revision_id: 4,
	revision_no: 2,
	player_role: "值班医生",
	place: "值班室",
};

/** 白板：现场看到的 + 你注意到的两块（与 view.situation 同源，所以只该出现一次）。 */
function makeBoard(): ScenarioBoard {
	return {
		editable: false,
		entry_count: 2,
		sections: [
			{
				id: "board_scene",
				title: "现场看到的",
				source: "cue",
				more: 0,
				entries: [
					{ id: "cue:c1", kind: "cue", text: "呼叫灯在闪", source: "pack" },
				],
			},
			{
				id: "board_noticed",
				title: "你注意到的",
				source: "noticed",
				more: 0,
				entries: [
					{ id: "noticed:0", kind: "noticed", text: "尿量 20ml/h", source: "dm" },
				],
			},
		],
	};
}

function makeView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return {
		session: { id: 31, status: "active", turn: 2, lost: false },
		pack: {
			key: PACK.key,
			title: PACK.title,
			player_role: "值班护士",
			revision_id: 4,
		},
		situation: {
			place: "病区护士站",
			time_hint: "凌晨 02:15",
			resources: ["电话", "病历本"],
			visible_cues: ["呼叫灯在闪"],
			noticed: ["尿量 20ml/h"],
		},
		actors: [
			{ id: "nurse", role: "值班护士老周", presence: "on_site", present: true },
			{ id: "consultant", role: "二线医生", presence: "remote", present: false },
			{ id: "backup", role: "备班护士", presence: "callable", present: false },
			{ id: "patient", role: "6 床患者", presence: "inaccessible", present: false },
		],
		hud: [
			{ slot: "尿量", source: "state", label: "尿量", value: 20, ref: "scene.urine" },
			{ slot: "线索", source: "cue", items: ["呼叫灯在闪"] },
			{ slot: "在场", source: "actor", items: ["值班护士老周"] },
			{ slot: "可做", source: "affordance", count: 3 },
		],
		messages: [
			{ role: "scene", text: "呼叫灯在闪。", turn: 1 },
			{
				role: "actor",
				actor: "nurse",
				actor_role: "值班护士老周",
				ephemeral: false,
				avatar_seed: "nurse",
				text: "6 床的尿袋我看过了。",
				origin: "dm",
			},
		],
		options: [],
		affordances: [
			{
				id: "ask_urine",
				type: "ask",
				label: "问尿量",
				select: "none",
				options: [],
				fields: [],
				free_input: true,
				confirm: false,
			},
		],
		free_input: true,
		timeline: [{ turn: 1, kind: "student", label: "看尿袋" }],
		dims: [],
		nudges: [],
		problems: [],
		...overrides,
	};
}

function renderConsole() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario"]}>
				<ScenarioConsole />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

async function enterSession(user: UserEvent, view: ScenarioView) {
	mocks.createScenarioSession.mockResolvedValue({
		session_id: view.session.id,
		pack: { key: PACK.key, title: PACK.title, revision_id: 4 },
		view,
	});
	renderConsole();
	await startPack(user, PACK.title);
	// 动作区常驻：它就是"已经进场"的稳定标志（affordance 不再上界面）
	await screen.findByLabelText("动作区");
}

beforeEach(() => {
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	mocks.createScenarioSession.mockResolvedValue({
		session_id: 31,
		pack: { key: PACK.key, title: PACK.title, revision_id: 4 },
		view: makeView(),
	});
	mocks.postScenarioAction.mockResolvedValue({
		session_id: 31,
		problems: [],
		view: makeView(),
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("学生侧渲染：诊断串与人话", () => {
	it("保底回合只给一句人话，原始诊断串不进学生界面", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				problems: [
					"dm_parse:Expecting value: line 1 column 1 (char 0)",
					"leaked_fact_term:spo2",
					"dm_fallback",
				],
			}),
		);

		expect(screen.getByText(STUDENT_FALLBACK_NOTICE)).toBeInTheDocument();
		expect(screen.queryByText(/dm_parse/)).not.toBeInTheDocument();
		expect(screen.queryByText(/leaked_fact_term/)).not.toBeInTheDocument();
		expect(screen.queryByText(/dm_fallback/)).not.toBeInTheDocument();
	});

	it("没有 problems 时不显示任何提示句", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView({ problems: [] }));
		expect(screen.queryByText(STUDENT_FALLBACK_NOTICE)).not.toBeInTheDocument();
	});
});

describe("学生侧渲染：在场者四种形态", () => {
	it("on_site=搭话 / remote=通话 / callable=可呼叫 都能点；inaccessible 只读且无按钮", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		expect(screen.getByText("搭话")).toBeInTheDocument();
		expect(screen.getByText("通话")).toBeInTheDocument();
		expect(screen.getByText("可呼叫")).toBeInTheDocument();
		// 不可接触的人不给提示词："不在视野"是平台在解释自己的投影规则
		expect(screen.queryByText("不在视野")).toBeNull();

		expect(
			screen.getByRole("button", { name: /值班护士老周/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /二线医生/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /备班护士/ })).toBeInTheDocument();
		// 「不在视野」的人看得到名字，但碰不着
		expect(screen.queryByRole("button", { name: /6 床患者/ })).toBeNull();
		expect(screen.getByText("6 床患者")).toBeInTheDocument();
	});

	it("点在场者只把焦点送进输入框，不替学生写字（没有「说：」句式）", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		await user.click(screen.getByRole("button", { name: /二线医生/ }));
		// 不预填任何收信人句式：学生看到自己没写过的文本会一眼看出是平台拼的
		const area = screen.getByLabelText("你要做什么");
		expect(area).toHaveValue("");
		expect(area).toHaveFocus();
		expect(document.querySelector(".sc-actions")?.textContent).not.toContain("说：");
	});

	it("学生面的关键容器不写系统/作者注解：没有「说：」，也没有全角括号", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				options: [
					{ label: "看看呼吸", type: "observe", affordance_id: null, params: {} },
				],
			}),
		);

		const selectors = [".sc-topbar", ".sc-actors", ".sc-actions", ".sc-options"];
		// 容器都得真的在（否则这条断言会因为"什么都没渲染"而白过）
		for (const selector of selectors) {
			expect(document.querySelector(selector)).not.toBeNull();
		}
		for (const selector of selectors) {
			const text = document.querySelector(selector)?.textContent ?? "";
			expect(text).not.toContain("（");
			expect(text).not.toContain("说：");
		}
	});
});

describe("学生侧渲染：HUD / 图片 / 线索 / 数值", () => {
	it("HUD 只留仪器读数（state），其余 source 不重复第二遍，也不暴露 pack 的内部字段名", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		const hud = document.querySelector(".sc-hud") as HTMLElement;
		const slots = hud.querySelectorAll(".sc-hud-slot");
		// cue/actor/affordance 是同一事实的第二处：线索在白板上、在场者在在场者条上
		expect(slots).toHaveLength(1);
		expect(hud.querySelector('[data-source="state"]')?.textContent).toContain("20");
		expect(hud.querySelector('[data-source="cue"]')).toBeNull();
		expect(hud.querySelector('[data-source="actor"]')).toBeNull();
		expect(hud.querySelector('[data-source="affordance"]')).toBeNull();
		// `ref` 是判读用的内部键，学生看不到
		expect(screen.queryByText(/scene\.urine/)).toBeNull();
	});

	it("主位图带 caption：caption 渲染在画面下方，不标图的来源", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				images: [
					{
						asset_id: "gen:abc",
						url: "/api/scenario/assets/4/gen:abc",
						title: "病区走廊",
						alt: "深夜走廊",
						caption: "走廊尽头的灯没关。",
						origin: "generated",
					},
				],
			}),
		);

		const caption = document.querySelector(".sc-caption");
		expect(caption?.textContent).toBe("走廊尽头的灯没关。");
		// 图从哪来是平台的事：学生面不写「AI 生成」这类口吻
		expect(screen.queryByText(/AI 生成/)).toBeNull();
	});

	it("包自带的图不上来源标；没有 caption 就不留一条空 caption", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				images: [
					{
						asset_id: "a_room",
						url: "/api/scenario/assets/4/a_room",
						title: "病房环境",
						alt: "夜班病房",
						caption: "",
						origin: "pack",
					},
				],
			}),
		);

		expect(document.querySelector(".sc-caption")).toBeNull();
		expect(screen.queryByText(/AI 生成/)).toBeNull();
		// 画面仍然说清"这是哪、几点"（地点/时间照旧给）
		expect(screen.getByText("病区护士站")).toBeInTheDocument();
		expect(screen.getByText("凌晨 02:15")).toBeInTheDocument();
	});

	it("线索只有一份来源：白板上分版块呈现，侧栏不再另列线索分组", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView({ board: makeBoard() }));

		const board = document.querySelector(".sc-board") as HTMLElement;
		expect(within(board).getByText("呼叫灯在闪")).toBeInTheDocument();
		expect(within(board).getByText("尿量 20ml/h")).toBeInTheDocument();
		// 版块标题就是作者给的名字，不带计数
		expect(screen.getByLabelText("现场看到的")).toBeInTheDocument();
		expect(screen.getByLabelText("你注意到的")).toBeInTheDocument();
		// 两块都有 → 一个卡片 + 两个页签（标签就是「线索」/「时间线」，没有计数）
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"线索",
			"时间线",
		]);
		const side = document.querySelector(".sc-side") as HTMLElement;
		expect(within(side).getAllByText("呼叫灯在闪")).toHaveLength(1);
		expect(within(side).getAllByText("尿量 20ml/h")).toHaveLength(1);
		expect(screen.queryByText(/已经摆在眼前的/)).toBeNull();
		expect(screen.queryByText(/我自己注意到的/)).toBeNull();
	});

	it("dims 里数值缺失显示「—」；判读口径（detail）不进学生面（展开顶栏细进度即见）", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				dims: [
					{
						id: "d_latency",
						label: "首次处置延迟",
						agg: "latency",
						value: null,
						unit: "回合",
						detail: "还没有可回推的动作",
					},
					{
						id: "d_ratio",
						label: "覆盖比例",
						agg: "ratio",
						value: 0.5,
						unit: "比例",
						detail: "",
					},
				],
			}),
		);

		const wrap = screen.getByLabelText("经历量化");
		await user.click(within(wrap).getByRole("button"));
		const panel = document.querySelector(".sc-progress-panel") as HTMLElement;
		expect(panel).not.toBeNull();
		expect(within(panel).getByText("—")).toBeInTheDocument();
		// detail 是后端判读口径（可能带内部字段名）→ 学生面逐字不渲染（管理侧回放才显示）
		expect(
			within(panel).queryByText("还没有可回推的动作"),
		).not.toBeInTheDocument();
	});

	it("view.free_input=false 时不给自己输入入口（DM 提示条照旧）", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				free_input: false,
				options: [{ label: "问一句", type: "ask", affordance_id: null, params: {} }],
			}),
		);

		expect(screen.queryByLabelText("你要做什么")).toBeNull();
		expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
		expect(document.querySelector(".sc-actions-row")).toBeNull();
		// 动作区照旧：自由通道没了不等于没得做
		expect(screen.getByLabelText("动作区")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "问一句" })).toBeInTheDocument();
	});
});

describe("学生侧渲染：我的情境经历", () => {
	it("没有历史时给空态；有历史时可回到那次经历", async () => {
		const user = userEvent.setup();
		mocks.listMyScenarioSessions.mockResolvedValue([
			{
				id: 12,
				pack_key: PACK.key,
				pack_title: PACK.title,
				status: "completed",
				turn: 7,
				lost: true,
				summary: { strong: 1, adequate: 2, missed: 1 },
				created_at: "2026-09-27T01:00:00Z",
				updated_at: "2026-09-27T02:00:00Z",
			},
		]);
		renderConsole();

		const history = await screen.findByLabelText("我的情境经历");
		const item = within(history).getByRole("button");
		// 一行说清：状态 · 第几回合 · 结局 · 锚点摘要 · 最后活动
		expect(
			within(item).getByText(
				/^已结束 · 第 7 回合 · 不可逆结局 · 强 1 · 合格 2 · 漏 1 · 最后活动 /,
			),
		).toBeInTheDocument();

		mocks.getScenarioSession.mockResolvedValue({
			session_id: 12,
			status: "completed",
			report: {
				pack: { key: PACK.key, title: PACK.title },
				turn: 7,
				lost: true,
				summary: { strong: 1, adequate: 2, missed: 1 },
				score: {
					rate: 0.45,
					weighted_sum: 1.8,
					total_weight: 4,
					criteria: [],
				},
				criteria: [],
				dims: [],
				timeline: [],
				problems: ["dm_fallback"],
			},
			view: makeView({ session: { id: 12, status: "completed", turn: 7, lost: true } }),
		});
		await user.click(item);

		await waitFor(() => {
			expect(mocks.getScenarioSession).toHaveBeenCalledWith(12);
		});
		// 已结算的经历直接落到经历页（不是回到"继续做动作"）
		const head = await screen.findByText(/^已达到不可逆结局 ｜ 共 7 回合$/);
		expect(head).toBeInTheDocument();
		// 结算页不再解释"下面是什么"
		expect(screen.queryByText(/下面是这次情境里真实发生过的判读/)).toBeNull();
	});

	it("没有历史时显示空态文案", async () => {
		renderConsole();
		expect(await screen.findByText("还没有情境经历。")).toBeInTheDocument();
	});

	it("经历再多也默认只铺 8 条：末尾「还有 N 次」展开，可再收起", async () => {
		const user = userEvent.setup();
		mocks.listMyScenarioSessions.mockResolvedValue(
			Array.from({ length: 12 }, (_, index) => ({
				id: index + 1,
				pack_key: PACK.key,
				pack_title: `第 ${index + 1} 次`,
				status: "completed",
				turn: index + 1,
				lost: false,
				summary: null,
				created_at: "2026-09-27T01:00:00Z",
				updated_at: "2026-09-27T02:00:00Z",
			})),
		);
		renderConsole();

		const history = await screen.findByLabelText("我的情境经历");
		expect(history.querySelectorAll(".sc-history-item")).toHaveLength(8);
		// 第 9 条起默认不渲染（不靠 CSS 藏，是真没进 DOM）
		expect(within(history).queryByText("第 9 次")).toBeNull();

		await user.click(within(history).getByRole("button", { name: "还有 4 次" }));
		expect(history.querySelectorAll(".sc-history-item")).toHaveLength(12);
		expect(within(history).getByText("第 12 次")).toBeInTheDocument();

		await user.click(within(history).getByRole("button", { name: "收起" }));
		expect(history.querySelectorAll(".sc-history-item")).toHaveLength(8);
	});
});

describe("学生侧渲染：入口页", () => {
	it("「情境训练」只出现一次（顶栏给标题），内容区靠 aria-label 立语义", async () => {
		renderConsole();
		await screen.findByText(PACK.title);

		expect(screen.getAllByText("情境训练")).toHaveLength(1);
		expect(screen.getByRole("region", { name: "情境训练" })).toBeInTheDocument();
	});

	it("病例卡：内容标题 + 学生语义徽章 + 贴底的开始动作；作者态字段不进学生面", async () => {
		const user = userEvent.setup();
		renderConsole();
		await screen.findByText(PACK.title);

		expect(
			screen.getByRole("heading", { level: 2, name: "选一个情境开始" }),
		).toBeInTheDocument();
		const card = screen.getByText(PACK.title).closest(".sc-pack");
		expect(card).not.toBeNull();
		const inCard = within(card as HTMLElement);
		expect(inCard.getByText(PACK.one_line)).toBeInTheDocument();
		// 徽章是"我是谁 / 我在哪"，来自病例自己的声明
		expect(inCard.getByText(PACK.player_role)).toBeInTheDocument();
		expect(inCard.getByText(PACK.place)).toBeInTheDocument();
		// 作者态字段（UI 审计 C4）：夹具的 state 就是 experimental，它不该出现在学生面
		expect(screen.queryByText(/experimental|修订/)).toBeNull();

		// 明确的开始动作：卡片本身不是按钮，动作在卡片里贴底
		await user.click(inCard.getByRole("button", { name: `开始「${PACK.title}」` }));
		await waitFor(() => {
			expect(mocks.createScenarioSession).toHaveBeenCalled();
		});
	});
});

describe("学生侧渲染：学生自己的话", () => {
	it("自由表达进对话流：学生气泡排在他引发的那段旁白之前", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());
		mocks.postScenarioAction.mockResolvedValue({
			view: makeView({
				session: { id: 12, status: "active", turn: 4, lost: false },
				messages: [
					{ role: "student", text: "我先看看瞳孔。", turn: 4, declaration: "act" },
					{ role: "scene", text: "瞳孔等大等圆，对光反射在。", turn: 4 },
				],
			}),
		});

		await chooseCustomAction(user);
		await user.type(screen.getByLabelText("你要做什么"), "我先看看瞳孔。");
		await user.click(screen.getByRole("button", { name: "发送" }));

		const bubble = (await screen.findByText("我先看看瞳孔。")).closest(".sc-line");
		expect(bubble).toHaveAttribute("data-role", "student");
		// 声明只体现在形态上：行动气泡带一个极小的标记，不写"执行："这类平台口吻
		expect(bubble).toHaveAttribute("data-declaration", "act");
		expect(bubble?.textContent).not.toContain("执行");
		const scene = screen.getByText("瞳孔等大等圆，对光反射在。").closest(".sc-line");
		expect(scene).not.toBeNull();
		// 他先做，世界才回应
		expect(
			(bubble as Element).compareDocumentPosition(scene as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

describe("学生侧渲染：会话已结束（409）", () => {
	it("动作被 409 拒绝后给冷色横幅与「看经历」，不再给动作区", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		mocks.postScenarioAction.mockRejectedValue({
			isAxiosError: true,
			message: "Request failed with status code 409",
			response: { status: 409, data: { detail: "该情境已结束" } },
		});
		await chooseCustomAction(user);
		await user.type(screen.getByLabelText("你要做什么"), "给他吸氧");
		await user.keyboard("{Enter}");

		expect(await screen.findByText("这次情境已经结束")).toBeInTheDocument();
		expect(screen.queryByLabelText("你要做什么")).toBeNull();
		expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
		// 出口还在：去看经历
		expect(screen.getByRole("button", { name: "看经历" })).toBeInTheDocument();
	});
});

describe("学生侧渲染：长内容与无面板", () => {
	it("长旁白不撑破布局（字幕条单列铺满，台词流自身滚动）", async () => {
		const user = userEvent.setup();
		const longText = "长".repeat(600);
		await enterSession(
			user,
			makeView({ messages: [{ role: "scene", text: longText, turn: 1 }] }),
		);

		const subtitle = document.querySelector(".sc-subtitle") as HTMLElement;
		expect(subtitle.textContent).toBe(longText);
		expect(document.querySelector(".sc-lines")).not.toBeNull();
		// 旁白不带头像、不落进头像那一列（少了这条规则，中文每行只剩一个字）
		const sceneLine = subtitle.closest(".sc-line") as HTMLElement;
		expect(sceneLine.dataset.role).toBe("scene");
		expect(sceneLine.querySelector(".sc-avatar")).toBeNull();
	});

	it("pack 声明的面板一个都不认识时不摆空壳，画面照旧", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView({ panels: ["future_panel"] }));

		// 没有线索、时间线又未声明 → 侧栏整块不渲染（不写空态说明句）
		expect(screen.queryByLabelText("经历面板")).toBeNull();
		expect(screen.queryByLabelText("经历量化")).toBeNull();
		// 资源不是对话流下缘的孤立名词行：它在场景带那一行里（且 panels 未声明 coverage → 不写）
		expect(screen.queryByText(/手边有/)).toBeNull();
		// 但场景与动作区照旧
		expect(screen.getByLabelText("场景画面")).toBeInTheDocument();
		expect(screen.getByLabelText("动作区")).toBeInTheDocument();
	});

	it("pack 没写 panels（空数组）时面板全开——老 pack 不该因此变哑", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				panels: [],
				dims: [
					{
						id: "d_ratio",
						label: "覆盖比例",
						agg: "ratio",
						value: 0.5,
						unit: "比例",
						detail: "",
					},
				],
			}),
		);

		// 时间线（没有线索 → 只有一块，不摆页签）
		const side = document.querySelector(".sc-side") as HTMLElement;
		expect(side).not.toBeNull();
		expect(within(side).getByText("看尿袋")).toBeInTheDocument();
		expect(within(side).queryAllByRole("tab")).toHaveLength(0);
		// 现场：资源并进场景带那一行，读起来是一句事实陈述（不再另起一行挂名词）
		expect(document.querySelector(".sc-stage-head")?.textContent).toContain("手边有：电话、病历本");
		// 经历量化
		expect(screen.getByLabelText("经历量化")).toBeInTheDocument();
	});
});

describe("学生侧渲染：内部键名不进学生面", () => {
	it("dims 的 detail（含 scene.spo2 这类字段名）不与 HUD 的 ref 一起泄漏到学生页", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				dims: [
					{
						id: "d_coverage",
						label: "已问到的关键项",
						agg: "coverage",
						value: 0.5,
						unit: "比例",
						// 后端 detail 是判读口径：里面是内部字段名（scene.spo2 / runtime_state）
						detail:
							"scene.spo2 初值 88 → 当前 88（runtime_state=force_rescore）",
					},
				],
			}),
		);

		const leaked = /scene\.|spo2|force_rescore|runtime_state/;
		// 收起态：HUD 的 `ref`（scene.urine）也不该被渲染出来
		expect(leaked.test(document.body.textContent ?? "")).toBe(false);

		// 顶栏细进度 → 弹层：**正控**（读数确实渲染了）之后，detail 仍然不出现
		await user.click(
			screen.getByRole("button", { name: /已问到的关键项/ }),
		);
		expect(document.querySelector(".sc-progress-panel")).not.toBeNull();
		expect(
			within(document.querySelector(".sc-progress-panel") as HTMLElement).getByText(
				"已问到的关键项",
			),
		).toBeInTheDocument();
		expect(leaked.test(document.body.textContent ?? "")).toBe(false);
	});
});
