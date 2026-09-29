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
	ScenarioGeneratedAsset,
	ScenarioView,
} from "@/api/scenario";
import AdminAssetsPanel from "@/scenario/admin/AdminAssetsPanel";
import AdminCaseOverviewPanel from "@/scenario/admin/AdminCaseOverviewPanel";
import AdminCaseRevisionsPanel from "@/scenario/admin/AdminCaseRevisionsPanel";
import AdminFocusPanel from "@/scenario/admin/AdminFocusPanel";
import AdminGeneratedPanel from "@/scenario/admin/AdminGeneratedPanel";
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
	patchAdminScenarioPack: vi.fn(),
	uploadAdminScenarioPack: vi.fn(),
	uploadAdminScenarioAsset: vi.fn(),
	deleteAdminScenarioAsset: vi.fn(),
	listAdminScenarioSessions: vi.fn(),
	getAdminScenarioSession: vi.fn(),
	getAdminScenarioStats: vi.fn(),
	listAdminGeneratedAssets: vi.fn(),
	deleteAdminGeneratedAsset: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		listAdminScenarioPacks: mocks.listAdminScenarioPacks,
		patchAdminScenarioPack: mocks.patchAdminScenarioPack,
		uploadAdminScenarioPack: mocks.uploadAdminScenarioPack,
		uploadAdminScenarioAsset: mocks.uploadAdminScenarioAsset,
		deleteAdminScenarioAsset: mocks.deleteAdminScenarioAsset,
		listAdminScenarioSessions: mocks.listAdminScenarioSessions,
		getAdminScenarioSession: mocks.getAdminScenarioSession,
		getAdminScenarioStats: mocks.getAdminScenarioStats,
		listAdminGeneratedAssets: mocks.listAdminGeneratedAssets,
		deleteAdminGeneratedAsset: mocks.deleteAdminGeneratedAsset,
	};
});

const PACK_KEY = "sputum-ineffective";

function pack(): ScenarioAdminPack {
	return {
		key: PACK_KEY,
		title: "吸痰无效：血氧上不来",
		state: "experimental",
		one_line: "夜班，患者痰多却吸不出来。",
		revision_id: 6,
		revision_no: 6,
		revisions: [{ id: 6, no: 6, note: "cli install" }],
		overview: {
			player_role: "夜班护士",
			place: "呼吸内科病房",
			time_hint: "凌晨 02:10",
			resources: ["床旁吸引器", "氧气装置"],
			actors: [{ id: "patient", role: "患者", presence: "on_site" }],
			// 教学关注点声明（锚点任务机已删除）：作者视角只有 id + 意图
			teaching_focus: [{ id: "f_assess", intent: "先核对呼吸音再决定吸痰" }],
			cues: 6,
			affordances: 8,
			reactions: 5,
			facts: 3,
			criteria: 5,
			criteria_weight: 100,
			failure: "irreversible",
			image_generation: "disabled",
		},
		assets: [
			{
				id: "a_room",
				kind: "image",
				title: "病房环境",
				alt: "",
				suggest_when: "",
				filename: "room-panel.png",
				mime_type: "image/png",
				file_size: 797,
				uploaded: true,
			},
		],
		sessions: 3,
	};
}

function generated(id: number): ScenarioGeneratedAsset {
	return {
		id,
		session_id: 100 + id,
		pack_key: PACK_KEY,
		pack_revision_id: 6,
		kind: "image",
		prompt: `夜班病房，患者半坐位喘着，第 ${id} 张`,
		mime_type: "image/png",
		file_size: 12_345,
		sha256: "abcdef0123456789",
		created_at: "2026-09-27T14:05:00+08:00",
	};
}

function sessionRow(id: number): ScenarioAdminSessionRow {
	return {
		id,
		user_id: 1,
		pack_key: PACK_KEY,
		pack_title: "吸痰无效：血氧上不来",
		pack_revision_id: 6,
		status: "completed",
		turn: 2,
		lost: false,
		summary: null,
		read_only: false,
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
		archived: false,
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

/** 打开一次会话的回放（详情面板按外部带过来的 id 自动展开）。 */
async function openDetail(detail: ScenarioAdminSessionDetail) {
	mocks.listAdminScenarioSessions.mockResolvedValue({ total: 1, items: [sessionRow(7)] });
	mocks.getAdminScenarioSession.mockResolvedValue(detail);
	renderWithProviders(<AdminSessionsPanel focusSessionId={7} />);
	await screen.findByText(/会话 #7/);
}

beforeEach(() => {
	mocks.listAdminScenarioPacks.mockResolvedValue([pack()]);
	mocks.listAdminScenarioSessions.mockResolvedValue({ total: 0, items: [] });
	mocks.getAdminScenarioStats.mockResolvedValue({ packs: [] });
	mocks.listAdminGeneratedAssets.mockResolvedValue({ items: [generated(1)], total: 1 });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("生成物面板：分页 / 筛选 / 删除 / 状态", () => {
	it("服务端分页：默认 20/页 offset=0，翻到第 2 页请求 offset=20", async () => {
		const user = userEvent.setup();
		mocks.listAdminGeneratedAssets.mockResolvedValue({
			items: [generated(1)],
			total: 45,
		});
		renderWithProviders(
			<AdminGeneratedPanel pack={pack()} />,
		);

		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenCalledWith(PACK_KEY, {
				limit: 20,
				offset: 0,
				session_id: null,
			});
		});
		expect(await screen.findByText(/第 1\/3 页/)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "2" }));
		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenCalledWith(PACK_KEY, {
				limit: 20,
				offset: 20,
				session_id: null,
			});
		});
	});

	it("按会话筛选：session_id 带进请求；清空恢复全量", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<AdminGeneratedPanel pack={pack()} />,
		);
		await screen.findByRole("row", { name: /夜班病房/ });

		await user.type(screen.getByLabelText("按会话筛选"), "101");
		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenCalledWith(PACK_KEY, {
				limit: 20,
				offset: 0,
				session_id: 101,
			});
		});

		await user.clear(screen.getByLabelText("按会话筛选"));
		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenLastCalledWith(PACK_KEY, {
				limit: 20,
				offset: 0,
				session_id: null,
			});
		});
	});

	it("删除要二次确认，确认后删并刷新当前页", async () => {
		const user = userEvent.setup();
		mocks.deleteAdminGeneratedAsset.mockResolvedValue({ deleted: 1, id: 1 });
		renderWithProviders(
			<AdminGeneratedPanel pack={pack()} />,
		);

		const row = await screen.findByRole("row", { name: /夜班病房/ });
		expect(mocks.listAdminGeneratedAssets).toHaveBeenCalledTimes(1);
		await user.click(within(row).getByRole("button", { name: "删除" }));

		// 二次确认：没确认前不删
		expect(mocks.deleteAdminGeneratedAsset).not.toHaveBeenCalled();
		expect(await screen.findByText(/删除生成物 #1/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		await waitFor(() => {
			expect(mocks.deleteAdminGeneratedAsset).toHaveBeenCalledWith(1);
		});
		// 刷新当前页（而不是只把那一行从内存里抹掉）
		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenCalledTimes(2);
		});
	});

	it("当前页删空 → 回退一页（不停在空列表上）", async () => {
		const user = userEvent.setup();
		mocks.listAdminGeneratedAssets.mockResolvedValue({
			items: [generated(21)],
			total: 21,
		});
		mocks.deleteAdminGeneratedAsset.mockResolvedValue({ deleted: 1, id: 21 });
		renderWithProviders(
			<AdminGeneratedPanel pack={pack()} />,
		);
		await screen.findByText(/第 1\/2 页/);

		await user.click(screen.getByRole("button", { name: "2" }));
		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenLastCalledWith(PACK_KEY, {
				limit: 20,
				offset: 20,
				session_id: null,
			});
		});

		const row = await screen.findByRole("row", { name: /夜班病房/ });
		await user.click(within(row).getByRole("button", { name: "删除" }));
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenLastCalledWith(PACK_KEY, {
				limit: 20,
				offset: 0,
				session_id: null,
			});
		});
	});

	it("空态按病例语境说话", async () => {
		mocks.listAdminGeneratedAssets.mockResolvedValue({ items: [], total: 0 });
		renderWithProviders(
			<AdminGeneratedPanel pack={pack()} />,
		);
		expect(await screen.findByText("该病例还没有 DM 生成物。")).toBeInTheDocument();
	});

	it("接口不存在（404）给明确说明 + 可重试，不白屏、不吐英文", async () => {
		const user = userEvent.setup();
		mocks.listAdminGeneratedAssets.mockRejectedValue({
			isAxiosError: true,
			response: { status: 404, data: {} },
			message: "Request failed with status code 404",
		});
		renderWithProviders(
			<AdminGeneratedPanel pack={pack()} />,
		);

		expect(
			await screen.findByText(/生成物接口在当前环境不可用/),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => {
			expect(mocks.listAdminGeneratedAssets).toHaveBeenCalledTimes(2);
		});
	});

	it("会话 id 可跳到会话回放", async () => {
		const user = userEvent.setup();
		const onOpenSession = vi.fn();
		renderWithProviders(
			<AdminGeneratedPanel pack={pack()} onOpenSession={onOpenSession} />,
		);
		await user.click(await screen.findByRole("button", { name: "#101" }));
		expect(onOpenSession).toHaveBeenCalledWith(101);
	});
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

	it("会话详情按外部带过来的 id 自动展开", async () => {
		await openDetail(sessionDetail());
		expect(mocks.getAdminScenarioSession).toHaveBeenCalledWith(7);
		expect(await screen.findByText(/回放视图（只读）/)).toBeInTheDocument();
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

describe("会话详情：报告三态与诊断问题", () => {
	it("新形状报告 → 按复盘页渲染（结局 / 关键时刻 / 判读），不是原始 JSON", async () => {
		await openDetail(sessionDetail({ report: makeReport(), turns: [] }));

		expect(screen.getByText("结算（新机制）")).toBeInTheDocument();
		expect(screen.getByText(/学生主动结束/)).toBeInTheDocument();
		const keyTurns = screen.getByRole("region", { name: "关键时刻" });
		expect(within(keyTurns).getByText("我先看看他的呼吸。")).toBeInTheDocument();
		expect(screen.queryByText(/只读留档/)).toBeNull();
		expect(screen.queryByText(/这次会话未结算/)).toBeNull();
	});

	it("只有切换前的旧报告 → 原样只读留档，绝不翻译成新形状", async () => {
		await openDetail({
			...sessionDetail({ report: null }),
			// `legacy_report` 不在后端的管理回放模型里；真出现时必须原样留档（见 AdminSessionsPanel 注释）
			legacy_report: { mechanism: "anchors", anchors_satisfied: 2 },
		} as ScenarioAdminSessionDetail & { legacy_report: Record<string, unknown> });

		expect(screen.getByText("切换前的原始报告（只读留档）")).toBeInTheDocument();
		// 原文照登：旧字段名一个字都不改
		expect(screen.getByText(/"anchors_satisfied": 2/)).toBeInTheDocument();
		// 不假装它是新形状，也不说它未结算
		expect(screen.queryByText("结算（新机制）")).toBeNull();
		expect(screen.queryByRole("region", { name: "关键时刻" })).toBeNull();
		expect(screen.queryByText(/这次会话未结算/)).toBeNull();
	});

	it("既没有报告也没有旧报告 → 如实写未结算", async () => {
		await openDetail(sessionDetail({ report: null }));

		expect(screen.getByText(/这次会话未结算/)).toBeInTheDocument();
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
	it("教学关注点声明成表：id + 意图，并写明「已处理」不等于能力达标", () => {
		renderWithProviders(<AdminCaseOverviewPanel pack={pack()} />);

		expect(screen.getByText(/教学关注点（1）/)).toBeInTheDocument();
		expect(screen.getByText("f_assess")).toBeInTheDocument();
		expect(screen.getByText("先核对呼吸音再决定吸痰")).toBeInTheDocument();
		expect(screen.getByText(/不等于能力达标/)).toBeInTheDocument();
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

	it("assets 可选：缺就是「没有声明资源」，不硬读", () => {
		const bare = { ...pack(), revisions: undefined, assets: undefined };
		renderWithProviders(<AdminCaseOverviewPanel pack={bare} />);

		expect(screen.getByText("资源：0 张，已上传 0 张")).toBeInTheDocument();
	});

	it("最新修订加载不出来 → 说明看不到声明内容，而不是空表", () => {
		const bare = { ...pack(), overview: undefined };
		renderWithProviders(<AdminCaseOverviewPanel pack={bare} />);

		expect(
			screen.getByText(/这份病例还没有可读的修订/),
		).toBeInTheDocument();
	});

	it("修订历史缺失（revisions 未声明）→ 空态，不是空白表", async () => {
		const bare = { ...pack(), revisions: undefined };
		renderWithProviders(<AdminCaseRevisionsPanel pack={bare} />);

		expect(await screen.findByText("这份病例还没有任何修订。")).toBeInTheDocument();
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

describe("修订面板：发布（改状态）要过确认框", () => {
	it("「发布（标记为已审）」要确认；取消则不落库，确认后才改", async () => {
		const user = userEvent.setup();
		renderWithProviders(<AdminCaseRevisionsPanel pack={pack()} />);

		await user.click(await screen.findByRole("button", { name: "发布（标记为已审）" }));

		expect(mocks.patchAdminScenarioPack).not.toHaveBeenCalled();
		expect(
			await screen.findByText(/把「吸痰无效：血氧上不来」标记为已审？/),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(mocks.patchAdminScenarioPack).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "发布（标记为已审）" }));
		await user.click(await screen.findByRole("button", { name: "改状态" }));
		await waitFor(() => {
			expect(mocks.patchAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY, {
				state: "reviewed",
			});
		});
	});

	it("修订历史逐条列出「变了什么」，当前修订有标记", async () => {
		const withHistory = pack();
		withHistory.revisions = [
			{ id: 8, no: 4, note: "asset:a_room by 20" },
			{ id: 7, no: 3, note: "drop asset:a_verify" },
			{ id: 6, no: 2, note: "" },
		];
		withHistory.revision_id = 8;
		withHistory.revision_no = 4;
		renderWithProviders(<AdminCaseRevisionsPanel pack={withHistory} />);

		const rows = await screen.findAllByRole("row");
		expect(screen.getByText("asset:a_room by 20")).toBeInTheDocument();
		expect(screen.getByText("drop asset:a_verify")).toBeInTheDocument();
		// 空说明不编词：如实一个占位
		expect(within(rows[3]).getByText("—")).toBeInTheDocument();
		// 当前修订只有一条，标在 #4 那一行
		expect(screen.getAllByText("当前")).toHaveLength(1);
		expect(within(rows[1]).getByText("当前")).toBeInTheDocument();
	});

	it("已审的病例：入口是「退回实验版」，确认文案跟着变", async () => {
		const user = userEvent.setup();
		const reviewed = pack();
		reviewed.state = "reviewed";
		renderWithProviders(<AdminCaseRevisionsPanel pack={reviewed} />);

		expect(
			screen.queryByRole("button", { name: "发布（标记为已审）" }),
		).toBeNull();
		await user.click(screen.getByRole("button", { name: "退回实验版" }));
		expect(await screen.findByText(/标记为实验版？/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "改状态" }));
		await waitFor(() => {
			expect(mocks.patchAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY, {
				state: "experimental",
			});
		});
	});
});

describe("场景缩略图：取不到字节不留空框", () => {
	/** 缩略图测试用视图：两张图，其中一张（a_missing）取不到字节。 */
	function assetView(): ScenarioView {
		return makeView({
			assets: [
				{ id: "a_room", title: "病房环境", alt: "", url: "/api/scenario/assets/6/a_room", suggest_when: "" },
				{ id: "a_missing", title: "还没上传的图", alt: "", url: "/api/scenario/assets/6/a_missing", suggest_when: "" },
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

	it("生成图取不到字节：不留空框，也不写「该图已被清理」这种平台口吻", async () => {
		const view = makeView({
			assets: [
				{
					id: "gen:abc123",
					title: "DM 生成图",
					alt: "",
					url: "/api/scenario/assets/6/gen:abc123",
					suggest_when: "",
				},
			],
		});
		const { container } = render(<ScenarioStage view={view} />);
		await waitFor(() => {
			expect(container.querySelectorAll(".sc-asset")).toHaveLength(0);
		});
		expect(container.textContent).not.toContain("该图已被清理");
		// 失败的是"这一次取不到字节"，不是"这张图不存在"
		expect(container.textContent).toContain("DM 生成图：图片加载失败");
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

describe("资源面板：assets 可选", () => {
	it("未声明 assets → 说清楚没有资源，而不是一张空表", () => {
		renderWithProviders(<AdminAssetsPanel pack={{ ...pack(), assets: undefined }} />);

		expect(screen.getByText("这个病例没有声明任何资源。")).toBeInTheDocument();
		expect(screen.queryByRole("columnheader", { name: "资源" })).toBeNull();
	});

	it("声明的资源逐条列出，字节状态如实标（缺字节的不能预览）", () => {
		const withMissing = pack();
		withMissing.assets = [
			...(withMissing.assets ?? []),
			{
				id: "a_missing",
				kind: "image",
				title: "还没上传的图",
				alt: "口咽部",
				suggest_when: "吸痰前",
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
