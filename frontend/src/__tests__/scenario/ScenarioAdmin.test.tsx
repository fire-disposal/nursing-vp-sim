import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioAdminAsset, ScenarioAdminPack } from "@/api/scenario";
import AdminAssetsPanel from "@/scenario/admin/AdminAssetsPanel";
import ScenarioAdminPage from "@/scenario/admin/ScenarioAdminPage";
import useAuthStore from "@/stores/authStore";

const mocks = vi.hoisted(() => ({
	listAdminScenarioPacks: vi.fn(),
	uploadAdminScenarioAsset: vi.fn(),
	deleteAdminScenarioAsset: vi.fn(),
	patchAdminScenarioPack: vi.fn(),
	uploadAdminScenarioPack: vi.fn(),
	listAdminScenarioSessions: vi.fn(),
	getAdminScenarioSession: vi.fn(),
	getAdminScenarioStats: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"@/api/scenario",
	);
	return {
		...actual,
		listAdminScenarioPacks: mocks.listAdminScenarioPacks,
		uploadAdminScenarioAsset: mocks.uploadAdminScenarioAsset,
		deleteAdminScenarioAsset: mocks.deleteAdminScenarioAsset,
		patchAdminScenarioPack: mocks.patchAdminScenarioPack,
		uploadAdminScenarioPack: mocks.uploadAdminScenarioPack,
		listAdminScenarioSessions: mocks.listAdminScenarioSessions,
		getAdminScenarioSession: mocks.getAdminScenarioSession,
		getAdminScenarioStats: mocks.getAdminScenarioStats,
	};
});

const PACK_KEY = "sputum-ineffective";

function asset(uploaded: boolean): ScenarioAdminAsset {
	return {
		id: "a_room",
		kind: "image",
		title: "病房环境",
		alt: "夜班病房",
		suggest_when: "开场时展示",
		filename: uploaded ? "room-panel.png" : "",
		mime_type: uploaded ? "image/png" : "",
		file_size: uploaded ? 797 : 0,
		uploaded,
	};
}

function pack(uploaded: boolean): ScenarioAdminPack {
	return {
		key: PACK_KEY,
		title: "术后低氧",
		state: "experimental",
		one_line: "术后第二天，患者呼吸费力。",
		revision_id: uploaded ? 8 : 7,
		revision_no: uploaded ? 4 : 3,
		revisions: [{ id: 7, no: 3, note: "cli install" }],
		assets: [asset(uploaded)],
		sessions: 2,
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

/** 往 Mantine FileInput 的 file input 里塞一个文件（点击打开系统对话框在 jsdom 里做不到）。 */
function attachFile(user: UserEvent, file: File) {
	const input = document.querySelector(
		'input[type="file"]',
	) as HTMLInputElement | null;
	if (!input) throw new Error("没有找到文件输入");
	return user.upload(input, file);
}

beforeEach(() => {
	mocks.listAdminScenarioPacks.mockResolvedValue([pack(false)]);
	mocks.listAdminScenarioSessions.mockResolvedValue({ total: 0, items: [] });
	mocks.getAdminScenarioStats.mockResolvedValue({ packs: [] });
	useAuthStore.setState({ permissions: ["case_manage", "stats_view"] });
});

afterEach(() => {
	vi.clearAllMocks();
	useAuthStore.setState({ permissions: [] });
});

describe("管理侧：权限门", () => {
	it("两个权限都没有 → 403 页，不是空白页", async () => {
		useAuthStore.setState({ permissions: [] });
		renderWithProviders(<ScenarioAdminPage />);

		expect(await screen.findByText("没有访问权限")).toBeInTheDocument();
		expect(
			screen.getByText(
				"这个页面需要「病例内容管理」或「数据查看」权限：前者管情境包与图片，后者看会话与统计。",
			),
		).toBeInTheDocument();
		expect(mocks.listAdminScenarioPacks).not.toHaveBeenCalled();
	});

	it("只有 stats_view → 只给会话与统计，不显示包与资源", async () => {
		useAuthStore.setState({ permissions: ["stats_view"] });
		renderWithProviders(<ScenarioAdminPage />);

		expect(await screen.findByRole("tab", { name: "会话" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "统计" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "情境包" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "资源" })).toBeNull();
		// 会话筛选要列包（`GET /admin/packs` 走的是 stats_view），但内容侧的写口一个都不碰
		expect(mocks.uploadAdminScenarioPack).not.toHaveBeenCalled();
	});

	it("只有 case_manage → 只给包与资源", async () => {
		useAuthStore.setState({ permissions: ["case_manage"] });
		renderWithProviders(<ScenarioAdminPage />);

		expect(await screen.findByRole("tab", { name: "情境包" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "资源" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "会话" })).toBeNull();
		expect(mocks.listAdminScenarioSessions).not.toHaveBeenCalled();
	});
});

describe("管理侧：上传图片后列表变已上传", () => {
	it("上传成功 → 追加修订、列表该项变 uploaded=true", async () => {
		const user = userEvent.setup();
		let uploaded = false;
		mocks.listAdminScenarioPacks.mockImplementation(() =>
			Promise.resolve([pack(uploaded)]),
		);
		mocks.uploadAdminScenarioAsset.mockImplementation(() => {
			uploaded = true;
			return Promise.resolve({
				key: PACK_KEY,
				revision_no: 4,
				asset: asset(true),
			});
		});

		renderWithProviders(
			<AdminAssetsPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
		);

		// 上传前：显眼的「未上传」
		const before = await screen.findByRole("row", { name: /a_room/ });
		expect(within(before).getByText("未上传")).toBeInTheDocument();
		expect(within(before).getByRole("button", { name: "预览" })).toBeDisabled();

		await attachFile(
			user,
			new File([new Uint8Array([137, 80, 78, 71])], "room.png", {
				type: "image/png",
			}),
		);
		await user.type(screen.getByLabelText(/asset_id/), "a_room");
		await user.click(screen.getByRole("button", { name: "上传并保存" }));

		await waitFor(() => {
			expect(mocks.uploadAdminScenarioAsset).toHaveBeenCalled();
		});
		const [key, payload] = mocks.uploadAdminScenarioAsset.mock.calls[0];
		expect(key).toBe(PACK_KEY);
		expect(payload.asset_id).toBe("a_room");
		expect(payload.file).toBeInstanceOf(File);

		// 列表重新取一次：同一条资源现在有字节了
		const after = await screen.findByRole("row", { name: /a_room/ });
		await waitFor(() => {
			expect(within(after).getByText("已上传")).toBeInTheDocument();
		});
		expect(within(after).queryByText("未上传")).toBeNull();
		expect(within(after).getByRole("button", { name: "预览" })).toBeEnabled();
		expect(within(after).getByText(/room-panel\.png/)).toBeInTheDocument();
	});

	it("没选包时不发请求（上传按钮只在选了包之后出现）", async () => {
		renderWithProviders(
			<AdminAssetsPanel packKey={null} onPackKeyChange={() => {}} />,
		);
		expect(
			await screen.findByText("先选一个情境包，就能看到它声明了哪些图、缺哪些字节。"),
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "上传并保存" })).toBeNull();
	});

	it("撤下资源要二次确认，确认后调用删除并刷新", async () => {
		const user = userEvent.setup();
		let uploaded = true;
		mocks.listAdminScenarioPacks.mockImplementation(() =>
			Promise.resolve([pack(uploaded)]),
		);
		mocks.deleteAdminScenarioAsset.mockImplementation(() => {
			uploaded = false;
			return Promise.resolve({ key: PACK_KEY, revision_no: 5, assets: [asset(false)] });
		});

		renderWithProviders(
			<AdminAssetsPanel packKey={PACK_KEY} onPackKeyChange={() => {}} />,
		);

		const row = await screen.findByRole("row", { name: /a_room/ });
		await user.click(within(row).getByRole("button", { name: "撤下" }));
		expect(
			await screen.findByText(
				"声明会从新修订里移除，字节在不再被任何修订引用时一并删除。已在跑的会话仍用它们开始时的修订。",
			),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "确认撤下" }));

		await waitFor(() => {
			expect(mocks.deleteAdminScenarioAsset).toHaveBeenCalledWith(PACK_KEY, "a_room");
		});
	});
});

describe("管理侧：诊断串只在这里出现", () => {
	it("会话详情展示问题清单与事件流，且明确标注仅维护者可见", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioSessions.mockResolvedValue({
			total: 1,
			items: [
				{
					id: 55,
					user_id: 7,
					pack_key: PACK_KEY,
					pack_title: "术后低氧",
					pack_revision_id: 7,
					status: "completed",
					turn: 4,
					lost: false,
					summary: { strong: 1, adequate: 0, missed: 0 },
					created_at: "2026-09-27T01:00:00Z",
					updated_at: "2026-09-27T01:30:00Z",
				},
			],
		});
		mocks.getAdminScenarioSession.mockResolvedValue({
			session: {
				id: 55,
				user_id: 7,
				pack_key: PACK_KEY,
				pack_title: "术后低氧",
				pack_revision_id: 7,
				status: "completed",
				turn: 4,
				lost: false,
				summary: { strong: 1, adequate: 0, missed: 0 },
				created_at: "2026-09-27T01:00:00Z",
				updated_at: "2026-09-27T01:30:00Z",
			},
			view: {
				session: { id: 55, status: "completed", turn: 4, lost: false },
				pack: { key: PACK_KEY, title: "术后低氧", player_role: "责任护士" },
				situation: {
					place: "外科病房",
					time_hint: "",
					resources: [],
					visible_cues: [],
					noticed: [],
				},
				actors: [],
				hud: [],
				messages: [{ role: "scene", text: "监护仪在响。", turn: 1 }],
				options: [],
				affordances: [],
				free_input: true,
				timeline: [],
				dims: [],
				nudges: [],
				problems: [],
			},
			report: null,
			problems: ["dm_parse:Expecting value", "leaked_fact_term:spo2"],
			event_count: 2,
			events: [
				{ kind: "student_action", payload: { turn: 1 } },
				{ kind: "dm_turn", payload: { problems: ["dm_parse:Expecting value"] } },
			],
		});

		renderWithProviders(<ScenarioAdminPage />);

		// 默认落在「情境包」分页，先进「会话」才看得到列表
		await user.click(await screen.findByRole("tab", { name: "会话" }));
		await user.click(await screen.findByRole("button", { name: "回放" }));

		expect(
			await screen.findByText(
				"诊断信息仅维护者可见：下面是每回合的问题清单（学生侧看不到这些原始串）。",
			),
		).toBeInTheDocument();
		expect(screen.getByText("dm_parse:Expecting value")).toBeInTheDocument();
		expect(screen.getByText("leaked_fact_term:spo2")).toBeInTheDocument();
		expect(screen.getByText("事件流（2）")).toBeInTheDocument();
		// 回放视图是只读的：在场者不给按钮，也没有自由输入条
		expect(screen.queryByLabelText("你要做什么")).toBeNull();
		expect(screen.queryByText("发送")).toBeNull();
	});
});
