import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioBoard, ScenarioView } from "@/api/scenario";
import { render, screen, waitFor, within } from "@/__tests__/render";
import { STUDENT_FALLBACK_NOTICE } from "@/scenario/problems";
import ScenarioConsole from "@/scenario/ScenarioConsole";

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
	await user.click(await screen.findByText(PACK.title));
	await screen.findByRole("button", { name: /问尿量/ });
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
		expect(screen.getByText("不在视野")).toBeInTheDocument();

		expect(
			screen.getByRole("button", { name: /值班护士老周/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /二线医生/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /备班护士/ })).toBeInTheDocument();
		// 「不在视野」的人看得到名字，但碰不着
		expect(screen.queryByRole("button", { name: /6 床患者/ })).toBeNull();
		expect(screen.getByText("6 床患者")).toBeInTheDocument();
	});

	it("点电话那头的人预填「对电话那头的…说：」，不是「搭话」", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		await user.click(screen.getByRole("button", { name: /二线医生/ }));
		expect(screen.getByLabelText("自己写一句")).toHaveValue(
			"对电话那头的二线医生说：",
		);
	});
});

describe("学生侧渲染：HUD / 图片 / 线索 / 数值", () => {
	it("HUD 四类 source 各自成形，且不暴露 pack 的内部字段名", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		const hud = document.querySelector(".sc-hud") as HTMLElement;
		const slots = hud.querySelectorAll(".sc-hud-slot");
		expect(slots).toHaveLength(4);
		expect(hud.querySelector('[data-source="state"]')?.textContent).toContain("20");
		expect(hud.querySelector('[data-source="cue"]')?.textContent).toContain("呼叫灯在闪");
		expect(hud.querySelector('[data-source="actor"]')?.textContent).toContain("值班护士老周");
		expect(hud.querySelector('[data-source="affordance"]')?.textContent).toContain("3");
		// `ref` 是判读用的内部键，学生看不到
		expect(screen.queryByText(/scene\.urine/)).toBeNull();
	});

	it("主位图带 caption，AI 生成的图有「AI 生成」标", async () => {
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

		expect(screen.getByText("走廊尽头的灯没关。")).toBeInTheDocument();
		expect(screen.getByText("AI 生成")).toBeInTheDocument();
	});

	it("pack 自带的图没有「AI 生成」标（不是生成的就别说生成）", async () => {
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
						caption: "墙上挂着呼叫铃。",
						origin: "pack",
					},
				],
			}),
		);

		expect(screen.getByText("墙上挂着呼叫铃。")).toBeInTheDocument();
		expect(screen.queryByText("AI 生成")).toBeNull();
	});

	it("线索只有一份来源：白板上分版块呈现，侧栏不再另列线索分组", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView({ board: makeBoard() }));

		const board = screen.getByLabelText("线索板");
		expect(within(board).getByText("呼叫灯在闪")).toBeInTheDocument();
		expect(within(board).getByText("尿量 20ml/h")).toBeInTheDocument();
		// 旧的两组线索清单已并入白板：侧栏里每条线索**只出现一次**（同一件事不说两遍）。
		// HUD 的现场读数仍在动作区一侧，那是另一回事（pack 声明的 slot），不算重复。
		const side = document.querySelector(".sc-side") as HTMLElement;
		expect(within(side).getAllByText("呼叫灯在闪")).toHaveLength(1);
		expect(within(side).getAllByText("尿量 20ml/h")).toHaveLength(1);
		expect(screen.queryByText(/已经摆在眼前的/)).toBeNull();
		expect(screen.queryByText(/我自己注意到的/)).toBeNull();
	});

	it("dims 里数值缺失显示「—」并给出原因", async () => {
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
				],
			}),
		);

		const panel = screen.getByLabelText("经历量化");
		expect(within(panel).getByText("—")).toBeInTheDocument();
		expect(within(panel).getByText("还没有可回推的动作")).toBeInTheDocument();
	});

	it("view.free_input=false 时不给自己输入入口", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView({ free_input: false }));

		expect(screen.queryByLabelText("自己写一句")).toBeNull();
		// 动作区照旧：自由通道没了不等于没得做
		expect(screen.getByRole("button", { name: /问尿量/ })).toBeInTheDocument();
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
		expect(within(item).getByText("已结算 · 7 回合 · 不可逆结局 · 强 1 · 合格 2 · 漏 1")).toBeInTheDocument();

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
		expect(
			await screen.findByText(
				"已达到不可逆结局——下面是这次情境里真实发生过的判读｜共 7 回合",
			),
		).toBeInTheDocument();
	});

	it("没有历史时显示空态文案", async () => {
		renderConsole();
		expect(
			await screen.findByText("还没有情境经历。挑上面的一个情境开始吧。"),
		).toBeInTheDocument();
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
		await user.click(screen.getByRole("button", { name: /问尿量/ }));

		expect(await screen.findByText("这次情境已经结束")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /问尿量/ })).toBeNull();
		expect(screen.queryByLabelText("自己写一句")).toBeNull();
	});
});

describe("学生侧渲染：长内容与无面板", () => {
	it("长旁白不撑破布局（字幕条可换行，台词流自身滚动）", async () => {
		const user = userEvent.setup();
		const longText = "长".repeat(600);
		await enterSession(
			user,
			makeView({ messages: [{ role: "scene", text: longText, turn: 1 }] }),
		);

		const subtitle = document.querySelector(".sc-subtitle") as HTMLElement;
		expect(subtitle.textContent).toBe(longText);
		expect(document.querySelector(".sc-lines")).not.toBeNull();
	});

	it("pack 声明的面板一个都不认识时给空态，而不是空白侧栏", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView({ panels: ["future_panel"] }));

		expect(screen.getByLabelText("经历面板")).toBeInTheDocument();
		expect(screen.queryByLabelText("经历时间线")).toBeNull();
		expect(screen.queryByLabelText("现场")).toBeNull();
	});

	it("pack 没写 panels（空数组）时三个面板全开——老 pack 不该因此变哑", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView({ panels: [] }));

		expect(screen.getByLabelText("经历时间线")).toBeInTheDocument();
		expect(screen.getByLabelText("现场")).toBeInTheDocument();
		expect(screen.getByLabelText("经历量化")).toBeInTheDocument();
	});
});
