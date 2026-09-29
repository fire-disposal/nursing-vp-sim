import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type {
	ScenarioAdminPack,
	ScenarioAdminSessionDetail,
	ScenarioAdminSessionRow,
	ScenarioView,
} from "@/api/scenario";
import AdminCaseOverviewPanel from "@/scenario/admin/AdminCaseOverviewPanel";
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
	listAdminScenarioSessions: vi.fn(),
	getAdminScenarioSession: vi.fn(),
	getAdminScenarioStats: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		listAdminScenarioPacks: mocks.listAdminScenarioPacks,
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
			cues: 6,
			affordances: 8,
			devices: 2,
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
		turns: [],
		event_count: 0,
		events: [],
		...overrides,
	};
}

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

describe("统计：按病例汇总", () => {
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
