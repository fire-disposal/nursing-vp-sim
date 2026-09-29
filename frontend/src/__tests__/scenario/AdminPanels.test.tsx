import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type {
	ScenarioAdminFocusTurn,
	ScenarioAdminPack,
	ScenarioAdminSessionDetail,
	ScenarioAdminSessionRow,
	ScenarioAdminStatsBucket,
	ScenarioAdminTurnReplay,
	ScenarioView,
} from "@/api/scenario";
import AdminAssetsPanel from "@/scenario/admin/AdminAssetsPanel";
import AdminCaseOverviewPanel from "@/scenario/admin/AdminCaseOverviewPanel";
import AdminFocusPanel from "@/scenario/admin/AdminFocusPanel";
import AdminSessionsPanel from "@/scenario/admin/AdminSessionsPanel";
import AdminStatsPanel from "@/scenario/admin/AdminStatsPanel";
import ScenarioStage from "@/scenario/ScenarioStage";
import { makeReport, makeView } from "./fixtures";

// AuthImage 替身：a_missing 走失败路径（真实组件失败时返回 null），其余成功。
// `vi.mock` 的工厂会被提升到文件顶部，工厂内只能动态 import（静态 import 在此不可用）。
vi.mock("@/components/ui/auth-image", async () => {
	const { useEffect } = await import("react");
	return {
		default: ({
			src,
			onStatus,
		}: {
			src: string;
			onStatus?: (status: string) => void;
		}) => {
			const failed = src.includes("a_missing") || src.includes("gen:");
			useEffect(() => {
				onStatus?.(failed ? "error" : "loaded");
			}, [failed, onStatus]);
			return failed ? null : <img src={src} alt="" />;
		},
	};
});

const mocks = vi.hoisted(() => ({
	listAdminScenarioPacks: vi.fn(),
	uploadAdminScenarioAsset: vi.fn(),
	replaceAdminScenarioAsset: vi.fn(),
	deleteAdminScenarioAsset: vi.fn(),
	listAdminScenarioSessions: vi.fn(),
	getAdminScenarioSession: vi.fn(),
	getAdminScenarioStats: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		listAdminScenarioPacks: mocks.listAdminScenarioPacks,
		uploadAdminScenarioAsset: mocks.uploadAdminScenarioAsset,
		replaceAdminScenarioAsset: mocks.replaceAdminScenarioAsset,
		deleteAdminScenarioAsset: mocks.deleteAdminScenarioAsset,
		listAdminScenarioSessions: mocks.listAdminScenarioSessions,
		getAdminScenarioSession: mocks.getAdminScenarioSession,
		getAdminScenarioStats: mocks.getAdminScenarioStats,
	};
});

const PACK_KEY = "sputum-ineffective";

function pack(): ScenarioAdminPack {
	return {
		key: PACK_KEY,
		title: "吸痰无效：血氧上不来",
		one_line: "夜班，患者痰多却吸不出来。",
		version: 3,
		published: true,
		published_at: "2026-09-29T12:00:00Z",
		overview: {
			player_role: "夜班护士",
			place: "呼吸内科病房",
			time_hint: "凌晨 02:10",
			resources: ["床旁吸引器", "氧气装置"],
			actors: [{ id: "patient", role: "患者", presence: "on_site" }],
			// 教学关注点声明：作者视角只有 id + 意图
			teaching_focus: [{ id: "f_assess", intent: "先核对呼吸音再决定吸痰" }],
			cues: 6,
			affordances: 8,
			reactions: 5,
			facts: 3,
			criteria: 5,
			criteria_weight: 100,
			failure: "irreversible",
		},
		assets: [
			{
				id: "a_room",
				kind: "image",
				title: "病房环境",
				alt: "",
				filename: "room-panel.png",
				mime_type: "image/png",
				file_size: 797,
				uploaded: true,
			},
		],
		sessions: 3,
	};
}

function sessionRow(id: number): ScenarioAdminSessionRow {
	return {
		id,
		user_id: 1,
		pack_key: PACK_KEY,
		pack_title: "吸痰无效：血氧上不来",
		pack_version: 3,
		status: "completed",
		turn: 2,
		lost: false,
		summary: null,
		trial: false,
		created_at: "2026-09-27T14:05:00+08:00",
		updated_at: "2026-09-27T14:05:00+08:00",
	};
}

function sessionDetail(
	overrides: Partial<ScenarioAdminSessionDetail> = {},
): ScenarioAdminSessionDetail {
	return {
		session: sessionRow(7),
		view: makeView(),
		report: null,
		problems: [],
		focus: [],
		turns: [],
		event_count: 0,
		events: [],
		...overrides,
	};
}

/** 教学关注点投影：一个时间单位有两条（相关且已处理 / 不相关未处理），开场那个还没投影。 */
const FOCUS: ScenarioAdminFocusTurn[] = [
	{ turn: 0, states: [] },
	{
		turn: 1,
		states: [
			{
				id: "f_assess",
				intent: "先核对呼吸音再决定吸痰",
				relevant: true,
				addressed: true,
				evidence_refs: ["auscultate", "fact_breath_sound"],
			},
			{
				id: "f_doc",
				intent: "把处置写进护理记录",
				relevant: false,
				addressed: false,
				evidence_refs: [],
			},
		],
	},
];

/** 一条完整的「解析 → 结算 → 交付」记录：三个阶段与调用计数都有内容。 */
const REPLAY: ScenarioAdminTurnReplay = {
	seq: 3,
	turn: 2,
	request_id: "req-abc",
	kind: "action",
	input: {
		kind: "action",
		target: { kind: "actor", id: "patient" },
		affordance_id: "suction",
		selection: ["deep", "shallow"],
		text: "我先吸引口咽部",
	},
	intent: { affordance_id: "suction", confidence: 0.8 },
	resolved: {
		request_id: "req-abc",
		base_seq: 2,
		turn: 2,
		time_cost: 1,
		outcome: "performed",
		block_reason: "",
		action: {
			kind: "action",
			affordance_id: "suction",
			label: "吸痰",
			target: { kind: "actor", id: "patient" },
			text: "",
			selection: [],
			outcome: "performed",
			block_reason: "",
		},
		effects: [
			{
				key: "vitals.spo2",
				op: "set",
				value: 89,
				old: 92,
				new: 89,
				turn: 2,
				source: "affordance:suction",
			},
		],
		reveals: ["痰液黏稠"],
		reactions: ["患者皱眉"],
		social: [
			{
				key: "patient.mood",
				op: "set",
				old: "calm",
				new: "distressed",
				turn: 2,
				source: "reaction",
			},
		],
		problems: [],
	},
	delivery: {
		messages: [
			{
				speaker: "2 床患者",
				as_role: "",
				ephemeral: false,
				text: "……轻点。",
				sources: ["pack:patient"],
			},
		],
		hints: ["看一眼血氧"],
		assets: ["a_room"],
		highlights: ["血氧 89%"],
	},
	outcome: "performed",
	block_reason: null,
	problems: ["dm_parse: 解析器把意图退回一次"],
	models: { parse: 2, delivery: 1 },
};

/** 只读的一次请求（澄清）：没有结算、没有交付，世界里什么都没变。 */
const CLARIFICATION: ScenarioAdminTurnReplay = {
	seq: 4,
	turn: 2,
	request_id: "req-clar",
	kind: "speech",
	input: { kind: "speech", text: "我该先做什么？", selection: [] },
	intent: { action: "ask" },
	resolved: null,
	delivery: null,
	outcome: "clarification",
	block_reason: null,
	problems: [],
	// `models` 省略 = 后端没有记录调用次数（不是 0 次，也不是 null）
};

/** 世界挡住了这一次尝试：结算存在，但没有任何状态改动。 */
const BLOCKED: ScenarioAdminTurnReplay = {
	seq: 5,
	turn: 3,
	request_id: "req-blocked",
	kind: "action",
	input: {
		kind: "action",
		target: { kind: "actor", id: "patient" },
		affordance_id: "suction",
		selection: [],
		text: "",
	},
	intent: { affordance_id: "suction" },
	resolved: {
		request_id: "req-blocked",
		base_seq: 4,
		turn: 3,
		time_cost: 1,
		outcome: "blocked",
		block_reason: "target_unreachable",
		action: {
			kind: "action",
			affordance_id: "suction",
			label: "吸痰",
			target: { kind: "actor", id: "patient" },
			text: "",
			selection: [],
			outcome: "blocked",
			block_reason: "target_unreachable",
		},
		effects: [],
		reveals: [],
		reactions: [],
		social: [],
		problems: [],
	},
	delivery: {
		messages: [
			{ speaker: "2 床患者", as_role: "", ephemeral: false, text: "……我喘不上气。", sources: [] },
		],
		hints: [],
		assets: [],
		highlights: [],
	},
	outcome: "blocked",
	block_reason: "target_unreachable",
	problems: [],
	models: { parse: 1, delivery: 1 },
};

function renderWithProviders(ui: React.ReactElement) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario-admin"]}>{ui}</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** 打开一次会话的回放：列表那一行的「回放」→ 详情面板展开。 */
async function openDetail(detail: ScenarioAdminSessionDetail) {
	mocks.listAdminScenarioSessions.mockResolvedValue({ total: 1, items: [sessionRow(7)] });
	mocks.getAdminScenarioSession.mockResolvedValue(detail);
	renderWithProviders(<AdminSessionsPanel />);
	await userEvent.click(await screen.findByRole("button", { name: "回放" }));
	await screen.findByText(/会话 #7/);
}

beforeEach(() => {
	mocks.listAdminScenarioPacks.mockResolvedValue([pack()]);
	mocks.listAdminScenarioSessions.mockResolvedValue({ total: 0, items: [] });
	mocks.getAdminScenarioStats.mockResolvedValue({ packs: [] });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("会话面板：服务端分页", () => {
	it("默认 offset=0，翻页按 50/页带 offset；总数超过一页才出现分页控件", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioSessions.mockResolvedValue({
			total: 120,
			items: [sessionRow(1)],
		});
		renderWithProviders(<AdminSessionsPanel />);

		await waitFor(() => {
			expect(mocks.listAdminScenarioSessions).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 50, offset: 0 }),
			);
		});
		expect(await screen.findByText(/第 1\/3 页/)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "2" }));
		await waitFor(() => {
			expect(mocks.listAdminScenarioSessions).toHaveBeenLastCalledWith(
				expect.objectContaining({ limit: 50, offset: 50 }),
			);
		});
	});

	it("会话详情按外部带过来的 id 自动展开；行上标的是用例版本号（不是修订 id）", async () => {
		await openDetail(sessionDetail());
		expect(mocks.getAdminScenarioSession).toHaveBeenCalledWith(7);
		expect(await screen.findByText(/回放视图（只读）/)).toBeInTheDocument();
		// `pack_version` 是用这一局开始时那份内容的版本号：列表里如实写「版本 #3」
		expect(screen.getByText(/版本 #3/)).toBeInTheDocument();
		expect(document.body.textContent ?? "").not.toContain("修订");
	});
});

describe("会话回放：教学关注点投影", () => {
	it("一行一个关注点：id / 意图 / 相关 / 已处理 / 证据引用，且写明「已处理」不是能力达标", async () => {
		const user = userEvent.setup();
		renderWithProviders(<AdminFocusPanel focus={FOCUS} turns={[]} />);

		const panel = screen.getByRole("region", { name: "教学关注点投影" });
		// 这一块只说"本包看到了什么证据"，不许暗示学生达标
		expect(
			within(panel).getByText(/不等于学生能力达标/),
		).toBeInTheDocument();
		expect(within(panel).getByText(/没有推进权/)).toBeInTheDocument();

		// 折叠着的时候投影不在 DOM 里
		const turn = within(panel).getByRole("button", {
			name: "时间单位 1 的教学关注点投影",
		});
		expect(within(panel).queryByText("f_assess")).toBeNull();

		await user.click(turn);
		expect(within(panel).getByText("f_assess")).toBeInTheDocument();
		expect(within(panel).getByText("先核对呼吸音再决定吸痰")).toBeInTheDocument();
		expect(within(panel).getByText("相关")).toBeInTheDocument();
		expect(within(panel).getByText("已处理")).toBeInTheDocument();
		expect(
			within(panel).getByText("证据：auscultate、fact_breath_sound"),
		).toBeInTheDocument();

		// 另一个关注点没相关也没处理：如实写「不相关 / 未处理 / 证据：无」
		expect(within(panel).getByText("f_doc")).toBeInTheDocument();
		expect(within(panel).getByText("不相关")).toBeInTheDocument();
		expect(within(panel).getByText("未处理")).toBeInTheDocument();
		expect(within(panel).getByText("证据：无")).toBeInTheDocument();
	});

	it("这个时间单位没有关注点投影时，空态长在它自己身上（不冒充成没声明）", async () => {
		const user = userEvent.setup();
		renderWithProviders(<AdminFocusPanel focus={FOCUS} turns={[]} />);

		const panel = screen.getByRole("region", { name: "教学关注点投影" });
		const opener = within(panel).getByRole("button", {
			name: "开场（时间 0） 的教学关注点投影",
		});
		expect(within(panel).getByText("0 个关注点")).toBeInTheDocument();

		await user.click(opener);
		expect(
			within(panel).getByText("（这个时间单位没有关注点投影）"),
		).toBeInTheDocument();
		// 整包没声明关注点是另一回事
		expect(within(panel).queryByText(/本包未声明教学关注点/)).toBeNull();
	});

	it("整包没声明关注点 / 还没有已提交请求：两处空态各说各的", () => {
		renderWithProviders(<AdminFocusPanel focus={null} turns={null} />);

		expect(screen.getByText("本包未声明教学关注点")).toBeInTheDocument();
		expect(screen.getByText("还没有已提交请求")).toBeInTheDocument();
	});
});

describe("会话回放：逐请求来源回放", () => {
	it("输入回声 / 解析 / 结算 / 交付 / 请求结果：三个阶段与调用计数都如实摆出来", async () => {
		const user = userEvent.setup();
		renderWithProviders(<AdminFocusPanel focus={[]} turns={[REPLAY]} />);

		const panel = screen.getByRole("region", { name: "逐请求来源回放" });
		// 这是**记录下来的产物**，不是模型自述的思考过程
		expect(within(panel).getByText(/记录下来的阶段产物/)).toBeInTheDocument();
		expect(within(panel).getByText(/不是模型的思考过程/)).toBeInTheDocument();

		const block = within(panel).getByRole("button", {
			name: "时间单位 2 的解析 / 结算 / 交付回放",
		});
		expect(block).toHaveAccessibleName(/时间单位 2/);
		expect(within(panel).getByText(/seq 3/)).toBeInTheDocument();
		expect(within(panel).queryByText("我先吸引口咽部")).toBeNull();

		await user.click(block);

		// 输入：学生请求原文（kind / 目标 / 声明动作 / 选项 / 自由文本）
		expect(within(panel).getByText("行动")).toBeInTheDocument();
		expect(within(panel).getByText("actor:patient")).toBeInTheDocument();
		expect(within(panel).getByText("suction")).toBeInTheDocument();
		expect(within(panel).getByText("选项：deep、shallow")).toBeInTheDocument();
		expect(within(panel).getByText("我先吸引口咽部")).toBeInTheDocument();

		// 解析：模型产物，口径写得清清楚楚
		expect(
			within(panel).getByText("模型解析产物，不是思考过程"),
		).toBeInTheDocument();
		expect(within(panel).getByText(/"affordance_id": "suction"/)).toBeInTheDocument();

		// 结算：动作 / 结果 / 效果旧→新 / 揭示 / 反应 / 人物状态
		expect(within(panel).getByText("吸痰")).toBeInTheDocument();
		expect(within(panel).getByText(/set vitals\.spo2：92 → 89/)).toBeInTheDocument();
		expect(within(panel).getByText("揭示：痰液黏稠")).toBeInTheDocument();
		expect(within(panel).getByText("反应：患者皱眉")).toBeInTheDocument();
		expect(
			within(panel).getByText(/patient.mood：calm → distressed/),
		).toBeInTheDocument();

		// 交付：谁说的 + 来源 + 提示／图片／高亮
		expect(within(panel).getByText("……轻点。")).toBeInTheDocument();
		expect(within(panel).getByText("来源：pack:patient")).toBeInTheDocument();
		expect(within(panel).getByText("提示：看一眼血氧")).toBeInTheDocument();
		expect(within(panel).getByText("图片：a_room")).toBeInTheDocument();
		expect(within(panel).getByText("高亮：血氧 89%")).toBeInTheDocument();

		// 请求结果：世界答复 / 阶段问题 / 模型调用计数
		expect(within(panel).getByText("问题（1）")).toBeInTheDocument();
		expect(
			within(panel).getByText("dm_parse: 解析器把意图退回一次"),
		).toBeInTheDocument();
		expect(within(panel).getByText(/解析 2 次 · 交付 1 次/)).toBeInTheDocument();
	});

	it("没有结算记录的请求说清楚世界没变（澄清与求提示只读），不假装结算过", async () => {
		const user = userEvent.setup();
		renderWithProviders(<AdminFocusPanel focus={[]} turns={[CLARIFICATION]} />);

		const block = screen.getByRole("button", {
			name: "时间单位 2 的解析 / 结算 / 交付回放",
		});
		// 行头就把这一次的结果说清楚
		expect(within(block).getByText("澄清（不结算）")).toBeInTheDocument();
		await user.click(block);

		expect(
			screen.getByText(/没有结算记录：没有推进世界——澄清与求提示只读/),
		).toBeInTheDocument();
		expect(screen.queryByText("效果（旧 → 新）")).toBeNull();
		expect(screen.getByText(/模型调用：未记录/)).toBeInTheDocument();
		// 没有交付记录也说清楚，不拿空块冒充产出
		expect(screen.getByText("（这一次请求没有交付记录）")).toBeInTheDocument();
	});

	it("受阻的请求：结算写「世界阻止」并给出受阻原因，且不假装有状态改动", async () => {
		const user = userEvent.setup();
		renderWithProviders(<AdminFocusPanel focus={[]} turns={[BLOCKED]} />);

		const block = screen.getByRole("button", {
			name: "时间单位 3 的解析 / 结算 / 交付回放",
		});
		expect(within(block).getByText("世界阻止")).toBeInTheDocument();
		await user.click(block);

		// 受阻原因在结算与请求结果两处都写出来（读的人不该拼信息）
		expect(screen.getAllByText(/受阻原因：target_unreachable/)).toHaveLength(2);
		expect(screen.getByText("（这一次请求没有状态改动）")).toBeInTheDocument();
		expect(screen.getByText("揭示：无")).toBeInTheDocument();
		expect(screen.getByText("反应：无")).toBeInTheDocument();
		expect(screen.getByText(/解析 1 次 · 交付 1 次/)).toBeInTheDocument();
	});

	it("会话详情把这两块接上（细节里的 focus / turns 才是数据源）", async () => {
		await openDetail(sessionDetail({ focus: FOCUS, turns: [REPLAY] }));

		expect(
			screen.getByRole("button", { name: "时间单位 1 的教学关注点投影" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "时间单位 2 的解析 / 结算 / 交付回放" }),
		).toBeInTheDocument();
		expect(screen.getByText(/回放视图（只读）/)).toBeInTheDocument();
	});
});

describe("会话详情：报告两态与诊断问题", () => {
	it("有报告 → 按复盘页渲染（结局 / 关键时刻 / 判读），不是原始 JSON", async () => {
		await openDetail(sessionDetail({ report: makeReport(), turns: [] }));

		expect(screen.getByText("结算（新机制）")).toBeInTheDocument();
		expect(screen.getByText(/学生主动结束/)).toBeInTheDocument();
		const keyTurns = screen.getByRole("region", { name: "关键时刻" });
		expect(within(keyTurns).getByText("我先看看他的呼吸。")).toBeInTheDocument();
		expect(screen.queryByText(/只读留档/)).toBeNull();
		expect(screen.queryByText(/这次会话没有结算/)).toBeNull();
	});

	it("没有报告 → 如实写未结算，不替它补一份", async () => {
		await openDetail(sessionDetail({ report: null }));

		expect(screen.getByText(/这次会话没有结算/)).toBeInTheDocument();
		expect(screen.queryByText("结算（新机制）")).toBeNull();
		expect(screen.queryByText(/只读留档/)).toBeNull();
	});

	it("诊断问题只给维护者看：标注维护者可见，并列出原始串", async () => {
		await openDetail(
			sessionDetail({
				problems: ["dm_parse: 解析器把意图退回一次", "leaked_fact_term: 血氧"],
				event_count: 12,
			}),
		);

		const notice = screen.getByText(/诊断信息仅维护者可见/);
		expect(notice).toBeInTheDocument();
		expect(screen.getByText(/问题清单（2）/)).toBeInTheDocument();
		expect(screen.getByText("dm_parse: 解析器把意图退回一次")).toBeInTheDocument();
		expect(screen.getByText("leaked_fact_term: 血氧")).toBeInTheDocument();
		expect(screen.getByText(/12 条事件/)).toBeInTheDocument();
	});

	it("problems / events / 台词都是可选字段：缺就当没有，不当崩溃", async () => {
		await openDetail({
			...sessionDetail(),
			problems: undefined,
			events: undefined,
		} as ScenarioAdminSessionDetail);

		expect(screen.getByText("这次会话没有诊断问题。")).toBeInTheDocument();
		expect(screen.getByText(/事件流（0）/)).toBeInTheDocument();
	});
});

describe("病例概览：声明了什么（不复制 DM 的真相）", () => {
	it("头一块报的是版本与上架状态（没有「审阅状态」这回事）", () => {
		renderWithProviders(<AdminCaseOverviewPanel pack={pack()} />);

		expect(screen.getByText("已上架")).toBeInTheDocument();
		expect(screen.getByText(/版本 #3/)).toBeInTheDocument();
		expect(screen.getByText(/上架于 2026-09-29T12:00:00Z/)).toBeInTheDocument();
		// 已删的概念不该回来
		expect(screen.queryByText(/实验版/)).toBeNull();
		expect(screen.queryByText(/已审/)).toBeNull();
		expect(screen.queryByText(/修订/)).toBeNull();
	});

	it("未上架的病例：写「未上架」，且不给上架时间", () => {
		renderWithProviders(
			<AdminCaseOverviewPanel pack={{ ...pack(), published: false, published_at: null }} />,
		);

		expect(screen.getByText("未上架")).toBeInTheDocument();
		expect(screen.queryByText(/上架于/)).toBeNull();
	});

	it("教学关注点声明成表：id + 意图，并写明「已处理」不等于能力达标", () => {
		renderWithProviders(<AdminCaseOverviewPanel pack={pack()} />);

		expect(screen.getByText("要练什么")).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "教学关注点" })).toBeInTheDocument();
		expect(screen.getByText("先核对呼吸音再决定吸痰")).toBeInTheDocument();
		expect(screen.getByText(/不代表学生是否达标/)).toBeInTheDocument();
		// 锚点任务机的东西不该回来
		expect(screen.queryByText(/锚点/)).toBeNull();
	});

	it("没有声明关注点 → 说清楚这一包不预设判断问题", () => {
		const bare = pack();
		bare.overview = { ...bare.overview!, teaching_focus: [] };
		renderWithProviders(<AdminCaseOverviewPanel pack={bare} />);

		expect(
			screen.getByText(/没有声明教学关注点：这份病例不预设判断问题/),
		).toBeInTheDocument();
	});

	it("assets 可选：缺就是「没有声明图片」，不硬读", () => {
		const bare = { ...pack(), assets: undefined };
		renderWithProviders(<AdminCaseOverviewPanel pack={bare} />);

		expect(screen.getByText(/图片：0 张，已上传 0 张/)).toBeInTheDocument();
	});

	it("当前内容读不出来（overview 缺）→ 说明看不到声明内容，而不是空表", () => {
		const bare = { ...pack(), overview: undefined };
		renderWithProviders(<AdminCaseOverviewPanel pack={bare} />);

		expect(
			screen.getByText(/这份病例还没有可读的内容/),
		).toBeInTheDocument();
	});
});

describe("统计：关注点处理比", () => {
	function bucket(overrides: Partial<ScenarioAdminStatsBucket> = {}): ScenarioAdminStatsBucket {
		return {
			pack_key: PACK_KEY,
			pack_title: "吸痰无效：血氧上不来",
			sessions: 3,
			completed: 2,
			lost: 1,
			focus_address_ratio: null,
			...overrides,
		};
	}

	it("没有关注点可算的病例写「—」（没有分母不是 0），有比值的按百分比读", async () => {
		mocks.getAdminScenarioStats.mockResolvedValue({
			packs: [
				bucket(),
				bucket({
					pack_key: "two_beds",
					pack_title: "两床同铃",
					focus_address_ratio: 0.25,
				}),
			],
		});
		renderWithProviders(<AdminStatsPanel />);

		const empty = await screen.findByRole("row", { name: /吸痰无效/ });
		expect(within(empty).getAllByRole("cell")[4]).toHaveTextContent("—");
		expect(within(empty).getAllByRole("cell")[4]).not.toHaveTextContent("0%");

		const counted = screen.getByRole("row", { name: /两床同铃/ });
		expect(within(counted).getAllByRole("cell")[4]).toHaveTextContent("25%");
		// 这个比值是"本包看到了多少处理证据"，不是能力等第
		expect(screen.getByText(/不是能力等第/)).toBeInTheDocument();
	});

	it("一个病例都没有会话时如实说没有可汇总的数据", async () => {
		mocks.getAdminScenarioStats.mockResolvedValue({ packs: [] });
		renderWithProviders(<AdminStatsPanel />);

		expect(
			await screen.findByText(/还没有任何情境会话，所以没有可汇总的数据/),
		).toBeInTheDocument();
	});
});

describe("场景缩略图：取不到字节不留空框", () => {
	/** 缩略图测试用视图：两张图，其中一张（a_missing）取不到字节。 */
	function assetView(): ScenarioView {
		return makeView({
			assets: [
				{ id: "a_room", title: "病房环境", alt: "", url: `/api/scenario/assets/${PACK_KEY}/a_room` },
				{ id: "a_missing", title: "还没上传的图", alt: "", url: `/api/scenario/assets/${PACK_KEY}/a_missing` },
			],
		});
	}

	it("有字节的照旧显示；取不到字节的不留空框，而是如实标出失败与重试", async () => {
		const { container } = render(<ScenarioStage view={assetView()} />);

		await waitFor(() => {
			// 只有 a_room 是缩略图；a_missing 不占一个空框
			expect(container.querySelectorAll(".sc-asset")).toHaveLength(1);
		});
		const only = container.querySelector(".sc-asset") as HTMLElement;
		expect(only.dataset.loaded).toBe("true");
		expect(within(only).getByText("病房环境")).toBeInTheDocument();

		// 失败的那张保留身份与可重试入口（技术故障不等于世界里没有这张图）
		const failed = container.querySelector(".sc-image-error") as HTMLElement;
		expect(failed.textContent).toContain("还没上传的图");
		expect(within(failed).getByRole("button", { name: "重试图片" })).toBeInTheDocument();
	});

	it("全部取不到字节 → 整条缩略图区不渲染", async () => {
		const view = assetView();
		view.assets = (view.assets ?? []).filter((asset) => asset.id !== "a_room");
		const { container } = render(<ScenarioStage view={view} />);
		await waitFor(() => {
			expect(container.querySelectorAll(".sc-asset")).toHaveLength(0);
		});
	});
});

describe("图片面板：assets 可选", () => {
	it("未声明 assets → 说清楚没有声明任何图片，而不是一张空表", () => {
		renderWithProviders(<AdminAssetsPanel pack={{ ...pack(), assets: undefined }} />);

		expect(screen.getByText(/这个病例没有声明任何图片/)).toBeInTheDocument();
		expect(screen.queryByRole("columnheader", { name: "图片" })).toBeNull();
	});

	it("声明的图片逐条列出，字节状态如实标（缺字节的不能预览）", () => {
		const withMissing = pack();
		withMissing.assets = [
			...(withMissing.assets ?? []),
			{
				id: "a_missing",
				kind: "image",
				title: "还没上传的图",
				alt: "口咽部",
				filename: "",
				mime_type: "",
				file_size: 0,
				uploaded: false,
			},
		];
		renderWithProviders(<AdminAssetsPanel pack={withMissing} />);

		const uploaded = screen.getByRole("row", { name: /病房环境/ });
		expect(within(uploaded).getByText("a_room")).toBeInTheDocument();
		expect(within(uploaded).getByText("已上传")).toBeInTheDocument();
		expect(within(uploaded).getByRole("button", { name: "预览" })).not.toBeDisabled();

		// 作者写了、库里还没有 → 学生端取图会 404：状态写实，预览关掉
		const missing = screen.getByRole("row", { name: /还没上传的图/ });
		expect(within(missing).getByText("未上传")).toBeInTheDocument();
		expect(within(missing).getByRole("button", { name: "预览" })).toBeDisabled();
	});
});
