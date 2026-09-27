import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type {
	ScenarioAdminPack,
	ScenarioGeneratedAsset,
	ScenarioView,
} from "@/api/scenario";
import AdminAssetsPanel from "@/scenario/admin/AdminAssetsPanel";
import AdminGeneratedPanel from "@/scenario/admin/AdminGeneratedPanel";
import AdminPacksPanel from "@/scenario/admin/AdminPacksPanel";
import AdminSessionsPanel from "@/scenario/admin/AdminSessionsPanel";
import ScenarioStage from "@/scenario/ScenarioStage";

// AuthImage 替身：a_missing 走失败路径（真实组件失败时返回 null），其余成功。
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

/** 缩略图测试用视图：两张图，其中一张（a_missing）会加载失败。 */
function assetView(): ScenarioView {
	return {
		session: { id: 1, status: "active", turn: 1, lost: false },
		pack: { key: PACK_KEY, title: "吸痰无效", player_role: "夜班护士" },
		situation: { place: "病房", time_hint: "", resources: [], visible_cues: [], noticed: [] },
		actors: [],
		hud: [],
		messages: [],
		options: [],
		affordances: [],
		free_input: true,
		timeline: [],
		dims: [],
		nudges: [],
		problems: [],
		assets: [
			{ id: "a_room", title: "病房环境", alt: "", url: "/api/scenario/assets/6/a_room", suggest_when: "" },
			{ id: "a_missing", title: "还没上传的图", alt: "", url: "/api/scenario/assets/6/a_missing", suggest_when: "" },
		],
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
			<AdminGeneratedPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
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
			<AdminGeneratedPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
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
			<AdminGeneratedPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
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
			<AdminGeneratedPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
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
			<AdminGeneratedPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
		);
		expect(await screen.findByText("该病例还没有 DM 生成物。")).toBeInTheDocument();
	});

	it("未选病例：先让人选，不请求", async () => {
		renderWithProviders(
			<AdminGeneratedPanel packKey={null} onPackKeyChange={() => {}} />,
		);
		expect(
			await screen.findByText("先选一个病例，就能看到它运行期生成过哪些图片。"),
		).toBeInTheDocument();
		expect(mocks.listAdminGeneratedAssets).not.toHaveBeenCalled();
	});

	it("接口不存在（404）给明确说明 + 可重试，不白屏、不吐英文", async () => {
		const user = userEvent.setup();
		mocks.listAdminGeneratedAssets.mockRejectedValue({
			isAxiosError: true,
			response: { status: 404, data: {} },
			message: "Request failed with status code 404",
		});
		renderWithProviders(
			<AdminGeneratedPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
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
			<AdminGeneratedPanel
				packKey={PACK_KEY}
				onPackKeyChange={() => {}}
				onOpenSession={onOpenSession}
			/>,
		);
		await user.click(await screen.findByRole("button", { name: "#101" }));
		expect(onOpenSession).toHaveBeenCalledWith(101);
	});
});

describe("会话面板：服务端分页", () => {
	function session(id: number) {
		return {
			id,
			user_id: 1,
			pack_key: PACK_KEY,
			pack_title: "吸痰无效：血氧上不来",
			pack_revision_id: 6,
			status: "completed",
			turn: 3,
			lost: false,
			summary: { strong: 1, adequate: 0, missed: 0 },
			created_at: "2026-09-27T14:05:00+08:00",
			updated_at: "2026-09-27T14:05:00+08:00",
		};
	}

	it("默认 offset=0，翻页按 50/页带 offset；总数超过一页才出现分页控件", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioSessions.mockResolvedValue({
			total: 120,
			items: [session(1)],
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
		mocks.listAdminScenarioSessions.mockResolvedValue({
			total: 1,
			items: [session(7)],
		});
		mocks.getAdminScenarioSession.mockResolvedValue({
			session: session(7),
			view: {
				session: { id: 7, status: "completed", turn: 3, lost: false },
				pack: { key: PACK_KEY, title: "吸痰无效：血氧上不来", player_role: "夜班护士" },
				situation: {
					place: "病房",
					time_hint: "",
					resources: [],
					visible_cues: [],
					noticed: [],
				},
				actors: [],
				hud: [],
				messages: [],
				options: [],
				affordances: [],
				free_input: true,
				timeline: [],
				dims: [],
				nudges: [],
				problems: [],
			},
			report: null,
			problems: [],
			event_count: 0,
			events: [],
		});
		renderWithProviders(<AdminSessionsPanel focusSessionId={7} />);

		await waitFor(() => {
			expect(mocks.getAdminScenarioSession).toHaveBeenCalledWith(7);
		});
		expect(await screen.findByText(/会话 #7/)).toBeInTheDocument();
	});
});

describe("资源面板：错误态", () => {
	it("列表读不出来就说清楚并可重试（不是一片空白）", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioPacks.mockRejectedValue({
			isAxiosError: true,
			response: { status: 403, data: {} },
		});
		renderWithProviders(
			<AdminAssetsPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
		);

		expect(await screen.findByText(/资源读取失败：没有访问权限/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => {
			expect(mocks.listAdminScenarioPacks).toHaveBeenCalledTimes(2);
		});
	});
});

describe("包面板：状态变更要确认", () => {
	it("改成「已审」要过确认框；取消则不落库", async () => {
		const user = userEvent.setup();
		renderWithProviders(<AdminPacksPanel onManageAssets={() => {}} />);

		const select = await screen.findByRole("combobox", {
			name: "吸痰无效：血氧上不来 的状态",
		});
		await user.click(select);
		await user.click(await screen.findByText("已审"));

		expect(mocks.patchAdminScenarioPack).not.toHaveBeenCalled();
		expect(
			await screen.findByText(/把「吸痰无效：血氧上不来」标记为已审？/),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(mocks.patchAdminScenarioPack).not.toHaveBeenCalled();

		// 确认之后才真的改
		await user.click(select);
		await user.click(await screen.findByText("已审"));
		await user.click(await screen.findByRole("button", { name: "改状态" }));
		await waitFor(() => {
			expect(mocks.patchAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY, {
				state: "reviewed",
			});
		});
	});
});

describe("场景缩略图：失败不留空框", () => {
	it("取不到字节的缩略图整块消失（有字节的照旧显示，且不留占位）", async () => {
		const { container } = render(<ScenarioStage view={assetView()} />);

		await waitFor(() => {
			// 只有 a_room 活下来；a_missing 失败 → 连按钮一起消失
			expect(container.querySelectorAll(".sc-asset")).toHaveLength(1);
		});
		const only = container.querySelector(".sc-asset") as HTMLElement;
		expect(only.dataset.loaded).toBe("true");
		expect(within(only).getByText("病房环境")).toBeInTheDocument();
		expect(container.textContent).not.toContain("还没上传的图");
	});

	it("生成图被清理后整块消失，不留空框也不留说明句", async () => {
		const view = assetView();
		view.assets = [
			{
				id: "gen:abc123",
				title: "DM 生成图",
				alt: "",
				url: "/api/scenario/assets/6/gen:abc123",
				suggest_when: "",
			},
		];
		const { container } = render(<ScenarioStage view={view} />);
		await waitFor(() => {
			expect(container.querySelectorAll(".sc-asset")).toHaveLength(0);
		});
		// 界面里没有它，就是世界里没有它：不留占位、不留"已被清理"这种平台口吻
		expect(container.textContent).not.toContain("该图已被清理");
		expect(container.textContent).not.toContain("DM 生成图");
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
