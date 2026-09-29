import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioAdminAsset, ScenarioAdminPack, ScenarioAdminPackSource } from "@/api/scenario";
import ScenarioAdminPage from "@/scenario/admin/ScenarioAdminPage";
import useAuthStore from "@/stores/authStore";

// AuthImage 替身：真组件会发一次带鉴权的图片请求——jsdom 的 origin 正是本机 dev server，
// 那一发 401 会触发 axios 的 refresh 流程并把权限清空，污染同一文件里后面的用例。
vi.mock("@/components/ui/auth-image", async () => {
	const { useEffect } = await import("react");
	return {
		default: ({ src, onStatus }: { src: string; onStatus?: (s: string) => void }) => {
			useEffect(() => {
				onStatus?.("loaded");
			}, [onStatus]);
			return <img src={src} alt="" />;
		},
	};
});

const mocks = vi.hoisted(() => ({
	listAdminScenarioPacks: vi.fn(),
	uploadAdminScenarioPack: vi.fn(),
	uploadAdminScenarioAsset: vi.fn(),
	deleteAdminScenarioAsset: vi.fn(),
	patchAdminScenarioPack: vi.fn(),
	listAdminScenarioSessions: vi.fn(),
	getAdminScenarioSession: vi.fn(),
	getAdminScenarioStats: vi.fn(),
	listAdminGeneratedAssets: vi.fn(),
	deleteAdminGeneratedAsset: vi.fn(),
	getAdminScenarioPackSource: vi.fn(),
	convertAdminScenarioPack: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		listAdminScenarioPacks: mocks.listAdminScenarioPacks,
		uploadAdminScenarioPack: mocks.uploadAdminScenarioPack,
		uploadAdminScenarioAsset: mocks.uploadAdminScenarioAsset,
		deleteAdminScenarioAsset: mocks.deleteAdminScenarioAsset,
		patchAdminScenarioPack: mocks.patchAdminScenarioPack,
		listAdminScenarioSessions: mocks.listAdminScenarioSessions,
		getAdminScenarioSession: mocks.getAdminScenarioSession,
		getAdminScenarioStats: mocks.getAdminScenarioStats,
		listAdminGeneratedAssets: mocks.listAdminGeneratedAssets,
		deleteAdminGeneratedAsset: mocks.deleteAdminGeneratedAsset,
		getAdminScenarioPackSource: mocks.getAdminScenarioPackSource,
		convertAdminScenarioPack: mocks.convertAdminScenarioPack,
	};
});

const PACK_KEY = "sputum-ineffective";
const OTHER_KEY = "two-beds-priority";

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

function pack(
	uploaded: boolean,
	key: string = PACK_KEY,
	title = "术后低氧",
): ScenarioAdminPack {
	return {
		key,
		title,
		state: "experimental",
		one_line: "术后第二天，患者呼吸费力。",
		revision_id: uploaded ? 8 : 7,
		revision_no: uploaded ? 4 : 3,
		revisions: [{ id: 7, no: 3, note: "cli install" }],
		assets: [asset(uploaded)],
		overview: {
			player_role: "夜班护士",
			place: "呼吸内科病房",
			time_hint: "凌晨 02:10",
			resources: ["床旁吸引器"],
			actors: [{ id: "patient", role: "患者", presence: "on_site" }],
			cues: 6,
			affordances: 8,
			reactions: 5,
			facts: 3,
			criteria: 5,
			criteria_weight: 100,
			failure: "irreversible",
			image_generation: "disabled",
		},
		sessions: 2,
	};
}

/** 修订的原始内容（`/source`）：形状就写在内容里的 `pack_schema_version` 上。 */
function source(revisionId = 7): ScenarioAdminPackSource {
	return {
		key: PACK_KEY,
		title: "术后低氧",
		state: "experimental",
		revision_id: revisionId,
		revision_no: 3,
		note: "cli install",
		content: {
			pack_schema_version: 3,
			key: PACK_KEY,
			title: "术后低氧",
			one_line: "术后第二天，患者呼吸费力。",
			player: { role: "夜班护士" },
			setting: { place: "呼吸内科病房", cues: [] },
			actors: [{ id: "patient", role: "患者", presence: "on_site" }],
			affordances: [],
			facts: [],
			rubric: [],
			presentation: {},
		},
		problems: [],
		revisions: [{ id: revisionId, no: 3, note: "cli install" }],
		schema_version: 3,
		current_schema_version: 3,
		compatible: true,
		legacy: false,
	};
}

/** 一份**切换前形状**的修订：只读，转换入口只出现在这样的行上。 */
function legacySource(revisionId = 7): ScenarioAdminPackSource {
	return {
		...source(revisionId),
		content: {
			pack_schema_version: 1,
			key: PACK_KEY,
			title: "术后低氧",
			anchors: [{ id: "a_start", stage: "airway", goal: "先测量与听诊" }],
		},
		schema_version: 1,
		compatible: false,
		legacy: true,
	};
}

function renderWithProviders(ui: React.ReactElement, entry = "/scenario-admin") {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** 从「病例」区进入某个病例的工作区（列表里那一行的显式入口）。 */
async function openCase(user: UserEvent, title = "术后低氧") {
	await user.click(await screen.findByRole("button", { name: "进入工作区" }));
	await screen.findByRole("button", { name: "返回病例列表" });
	return title;
}

/** 往 Mantine FileInput 的 file input 里塞一个文件（点击打开系统对话框在 jsdom 里做不到）。 */
function attachFile(user: UserEvent, file: File) {
	const input = document.querySelector(
		'input[type="file"]',
	) as HTMLInputElement | null;
	if (!input) throw new Error("没有找到文件输入");
	return user.upload(input, file);
}

/** 从病例工作区进入「修订」块（形状与转换入口都在那里）。 */
async function openRevisions(user: UserEvent) {
	await openCase(user);
	await user.click(await screen.findByRole("tab", { name: "修订" }));
}

beforeEach(() => {
	mocks.listAdminScenarioPacks.mockResolvedValue([pack(false)]);
	mocks.listAdminScenarioSessions.mockResolvedValue({ total: 0, items: [] });
	mocks.getAdminScenarioStats.mockResolvedValue({ packs: [] });
	mocks.listAdminGeneratedAssets.mockResolvedValue({ items: [], total: 0 });
	mocks.getAdminScenarioPackSource.mockResolvedValue(source());
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

	it("只有 stats_view → 病例区照常进得去，但工作区里只有会话与统计", async () => {
		const user = userEvent.setup();
		useAuthStore.setState({ permissions: ["stats_view"] });
		renderWithProviders(<ScenarioAdminPage />);

		// 两个区都在（病例清单本身走数据口径 `/admin/packs`）；默认落在数据区
		expect(await screen.findByRole("tab", { name: "会话" })).toBeInTheDocument();
		await user.click(screen.getByRole("radio", { name: "病例" }));
		// 没有内容权限 → 连上传入口都不给
		expect(screen.queryByRole("button", { name: "上传" })).toBeNull();

		await openCase(user);
		expect(await screen.findByRole("tab", { name: "会话" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "统计" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "概览" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "修订" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "资源" })).toBeNull();
		expect(mocks.uploadAdminScenarioPack).not.toHaveBeenCalled();
	});

	it("只有 case_manage → 没有「会话 / 统计」区，病例工作区里只有内容块", async () => {
		const user = userEvent.setup();
		useAuthStore.setState({ permissions: ["case_manage"] });
		renderWithProviders(<ScenarioAdminPage />);

		expect(await screen.findByRole("button", { name: "进入工作区" })).toBeInTheDocument();
		expect(screen.queryByRole("radio", { name: "会话 / 统计" })).toBeNull();

		await openCase(user);
		expect(await screen.findByRole("tab", { name: "概览" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "修订" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "资源" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "生成物" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "会话" })).toBeNull();
		expect(mocks.listAdminScenarioSessions).not.toHaveBeenCalled();
	});

	it("数据区的块按名字可达（会话 / 统计 / 归档），且哪一个在被读由 aria-selected 表达", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ScenarioAdminPage />);

		await user.click(await screen.findByRole("radio", { name: "会话 / 统计" }));
		// 不写死顺序与个数：只要求这几个名字都可达
		for (const name of ["会话", "统计", "归档"]) {
			expect(screen.getByRole("tab", { name })).toBeInTheDocument();
		}
		expect(screen.getByRole("tab", { name: "会话" })).toHaveAttribute(
			"aria-selected",
			"true",
		);

		// 归档是**数据区**的块：它不接管病例工作区的页签
		await user.click(screen.getByRole("radio", { name: "病例" }));
		await openCase(user);
		expect(await screen.findByRole("tab", { name: "概览" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "归档" })).toBeNull();
	});
});

describe("管理侧：病例选择只有一处、清单只有一份", () => {
	it("从列表进工作区：头部就是病例本身，块里没有第二个病例选择器", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ScenarioAdminPage />);

		await openCase(user);
		// 头部：病例名 + 关键信息 + 返回
		const head = document.querySelector(".sc-admin-case-head") as HTMLElement;
		expect(within(head).getByText("术后低氧")).toBeInTheDocument();
		expect(
			within(head).getByRole("button", { name: "返回病例列表" }),
		).toBeInTheDocument();

		// 「生成物」块里没有病例下拉（旧的重复选择器就长在这里）
		await user.click(screen.getByRole("tab", { name: "生成物" }));
		expect(screen.queryByLabelText("按病例筛选")).toBeNull();
		expect(mocks.listAdminGeneratedAssets).toHaveBeenCalledWith(PACK_KEY, {
			limit: 20,
			offset: 0,
			session_id: null,
		});

		// 「会话」块里也没有病例筛选（它锁在头部的那个病例上）
		await user.click(screen.getByRole("tab", { name: "会话" }));
		expect(screen.queryByLabelText("按病例筛选")).toBeNull();
		await waitFor(() => {
			expect(mocks.listAdminScenarioSessions).toHaveBeenCalledWith(
				expect.objectContaining({ pack_key: PACK_KEY }),
			);
		});
	});

	it("换块不重复拉病例清单（一份真源，不是每块各拉一份）", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ScenarioAdminPage />);

		await openCase(user);
		await user.click(screen.getByRole("tab", { name: "资源" }));
		await user.click(screen.getByRole("tab", { name: "修订" }));
		await user.click(screen.getByRole("tab", { name: "概览" }));

		await waitFor(() => {
			expect(mocks.listAdminScenarioPacks).toHaveBeenCalledTimes(1);
		});
	});

	it("地址栏带着病例：刷新/直达直接落在它的工作区；返回列表清掉参数", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<ScenarioAdminPage />,
			`/scenario-admin?case=${PACK_KEY}&block=revisions`,
		);

		expect(await screen.findByRole("button", { name: "返回病例列表" })).toBeInTheDocument();
		expect(await screen.findByRole("tab", { name: "修订" })).toHaveAttribute(
			"aria-selected",
			"true",
		);

		await user.click(screen.getByRole("button", { name: "返回病例列表" }));
		expect(
			await screen.findByRole("button", { name: "进入工作区" }),
		).toBeInTheDocument();
	});

	it("地址栏里的病例不存在：说清楚并给出回列表的路，不白屏", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioPacks.mockResolvedValue([pack(false)]);
		renderWithProviders(<ScenarioAdminPage />, "/scenario-admin?case=ghost");

		expect(await screen.findByText(/没有 `ghost` 这个病例/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "返回病例列表" }));
		expect(
			await screen.findByRole("button", { name: "进入工作区" }),
		).toBeInTheDocument();
	});

	it("跨病例区：会话列表按病例筛选，统计是全局的", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioPacks.mockResolvedValue([
			pack(false, PACK_KEY, "术后低氧"),
			pack(false, OTHER_KEY, "两床同铃"),
		]);
		renderWithProviders(<ScenarioAdminPage />);

		await user.click(await screen.findByRole("radio", { name: "会话 / 统计" }));
		// 可选的病例筛选：默认空 = 全部
		const filter = await screen.findByLabelText("按病例筛选");
		await waitFor(() => {
			expect(mocks.listAdminScenarioSessions).toHaveBeenCalledWith(
				expect.objectContaining({ pack_key: null }),
			);
		});
		await user.click(filter);
		await user.click(await screen.findByText("两床同铃（two-beds-priority）"));
		await waitFor(() => {
			expect(mocks.listAdminScenarioSessions).toHaveBeenLastCalledWith(
				expect.objectContaining({ pack_key: OTHER_KEY }),
			);
		});

		await user.click(screen.getByRole("tab", { name: "统计" }));
		await waitFor(() => {
			expect(mocks.getAdminScenarioStats).toHaveBeenCalled();
		});
	});
});

describe("管理侧：上传图片后列表变已上传（同一个病例、同一份清单）", () => {
	it("上传成功 → 追加修订、工作区头部与资源表都变已上传", async () => {
		const user = userEvent.setup();
		let uploaded = false;
		mocks.listAdminScenarioPacks.mockImplementation(() =>
			Promise.resolve([pack(uploaded)]),
		);
		mocks.uploadAdminScenarioAsset.mockImplementation(() => {
			uploaded = true;
			return Promise.resolve({ key: PACK_KEY, revision_no: 4, asset: asset(true) });
		});

		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);
		await user.click(await screen.findByRole("tab", { name: "资源" }));

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

		// 清单重新取一次：同一个病例的那一条现在有字节了（头部修订号也跟着变）
		const after = await screen.findByRole("row", { name: /a_room/ });
		await waitFor(() => {
			expect(within(after).getByText("已上传")).toBeInTheDocument();
		});
		expect(within(after).queryByText("未上传")).toBeNull();
		expect(within(after).getByRole("button", { name: "预览" })).toBeEnabled();
		// 工作区头部与资源块说的是同一个修订号（一份真源，不是两处各记一个）
		expect(screen.getAllByText(/修订 #4/).length).toBeGreaterThan(0);
	});

	it("撤下资源要二次确认，确认后调用删除", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioPacks.mockResolvedValue([pack(true)]);
		mocks.deleteAdminScenarioAsset.mockResolvedValue({
			key: PACK_KEY,
			revision_no: 5,
			assets: [asset(false)],
		});

		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);
		await user.click(await screen.findByRole("tab", { name: "资源" }));

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

describe("管理侧：生成物 → 会话 的块内跳转", () => {
	it("点生成物的会话号 → 落到同一病例的会话块并展开那一次", async () => {
		const user = userEvent.setup();
		mocks.listAdminGeneratedAssets.mockResolvedValue({
			items: [
				{
					id: 1,
					session_id: 101,
					pack_key: PACK_KEY,
					pack_revision_id: 6,
					kind: "image",
					prompt: "夜班病房",
					mime_type: "image/png",
					file_size: 10,
					sha256: "abcdef0123",
					created_at: "2026-09-27T14:05:00+08:00",
				},
			],
			total: 1,
		});
		mocks.listAdminScenarioSessions.mockResolvedValue({ total: 0, items: [] });
		mocks.getAdminScenarioSession.mockResolvedValue({
			session: {
				id: 101,
				user_id: 1,
				pack_key: PACK_KEY,
				pack_title: "术后低氧",
				pack_revision_id: 6,
				status: "active",
				turn: 1,
				lost: false,
				summary: null,
				created_at: "2026-09-27T14:05:00+08:00",
				updated_at: "2026-09-27T14:05:00+08:00",
			},
			view: {
				session: { id: 101, status: "active", turn: 1, lost: false },
				pack: { key: PACK_KEY, title: "术后低氧", player_role: "夜班护士" },
				situation: {
					place: "外科病房",
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

		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);
		await user.click(await screen.findByRole("tab", { name: "生成物" }));
		await user.click(await screen.findByRole("button", { name: "#101" }));

		expect(await screen.findByRole("tab", { name: "会话" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await waitFor(() => {
			expect(mocks.getAdminScenarioSession).toHaveBeenCalledWith(101);
		});
		expect(await screen.findByText(/会话 #101/)).toBeInTheDocument();
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
				messages: [
					{
						id: "m1",
						role: "scene",
						kind: "narration",
						text: "监护仪在响。",
						turn: 1,
						ephemeral: false,
						origin: "world",
					},
				],
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

		// 跨病例区 → 会话（默认块）→ 回放
		await user.click(await screen.findByRole("radio", { name: "会话 / 统计" }));
		// turn 是情境时间单位，不是"第 N 回合 / 提交次数"
		expect(await screen.findByRole("columnheader", { name: "时间单位" })).toBeInTheDocument();
		await user.click(await screen.findByRole("button", { name: "回放" }));

		expect(
			await screen.findByText(
				(text) => text.includes("仅维护者可见") && text.includes("学生侧看不到"),
			),
		).toBeInTheDocument();
		expect(screen.getByText("dm_parse:Expecting value")).toBeInTheDocument();
		expect(screen.getByText("leaked_fact_term:spo2")).toBeInTheDocument();
		expect(screen.getByText("事件流（2）")).toBeInTheDocument();
		// 回放视图是只读的：在场者不给按钮，也没有自由输入条
		expect(screen.queryByLabelText("你要做什么")).toBeNull();
		expect(screen.queryByText("发送")).toBeNull();
		// 学生侧看不到原始串，管理侧也不该出现"回合"这个被废弃的口径
		expect(document.body.textContent ?? "").not.toContain("回合");
	});
});

describe("管理侧：修订块的转换结果要经得起核对", () => {
	/** 转换入口只出现在**读出来是历史形状**的那些行上；这里整份病例只有这一份修订。 */
	function legacyPackage() {
		mocks.getAdminScenarioPackSource.mockResolvedValue(legacySource());
	}

	it("结果里的 key 不是本病例 → 明说这次转换没以该修订为输入", async () => {
		const user = userEvent.setup();
		legacyPackage();
		mocks.convertAdminScenarioPack.mockResolvedValue({
			content: { pack_schema_version: 3, key: "ghost-pack", title: "别的病例" },
			notes: [],
			problems: [],
			from_schema_version: 1,
			to_schema_version: 3,
		});
		renderWithProviders(<ScenarioAdminPage />);
		await openRevisions(user);

		await user.click(await screen.findByRole("button", { name: /转换到 v3 草稿/ }));
		expect(mocks.convertAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY, 7);

		expect(
			await screen.findByText(
				(text) => text.includes("ghost-pack") && text.includes(PACK_KEY),
			),
		).toBeInTheDocument();
	});

	it("结果声称的来源形状对不上这份修订 → 同样拒绝认账", async () => {
		const user = userEvent.setup();
		legacyPackage();
		mocks.convertAdminScenarioPack.mockResolvedValue({
			content: { pack_schema_version: 3, key: PACK_KEY, title: "术后低氧" },
			notes: [],
			problems: [],
			from_schema_version: 9,
			to_schema_version: 3,
		});
		renderWithProviders(<ScenarioAdminPage />);
		await openRevisions(user);

		await user.click(await screen.findByRole("button", { name: /转换到 v3 草稿/ }));

		expect(
			await screen.findByText((text) => text.includes("v9") && text.includes("v1")),
		).toBeInTheDocument();
	});

	it("对得上的转换结果照常给 notes/problems，不打「来源不符」的警报", async () => {
		const user = userEvent.setup();
		legacyPackage();
		mocks.convertAdminScenarioPack.mockResolvedValue({
			content: { pack_schema_version: 3, key: PACK_KEY, title: "术后低氧" },
			notes: ["anchors → teaching_focus（1 条）"],
			problems: [],
			from_schema_version: 1,
			to_schema_version: 3,
		});
		renderWithProviders(<ScenarioAdminPage />);
		await openRevisions(user);

		await user.click(await screen.findByRole("button", { name: /转换到 v3 草稿/ }));

		expect(await screen.findByText("anchors → teaching_focus（1 条）")).toBeInTheDocument();
		expect(
			screen.queryByText((text) => text.includes("没有以这份修订的内容为输入")),
		).toBeNull();
	});
});

describe("管理侧：时间语义（turn = 情境时间单位，不是请求计数）", () => {
	it("走过病例工作区各块与数据区：全页没有「回合」，turn 一律写成「时间单位」", async () => {
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
		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);

		for (const name of ["概览", "编辑", "修订", "资源", "生成物", "统计", "会话"]) {
			await user.click(await screen.findByRole("tab", { name }));
			expect(document.body.textContent ?? "").not.toContain("回合");
		}
		expect(
			await screen.findByRole("columnheader", { name: "时间单位" }),
		).toBeInTheDocument();

		// 跨病例区看同一次会话，口径一致
		await user.click(screen.getByRole("radio", { name: "会话 / 统计" }));
		expect(screen.getByRole("columnheader", { name: "时间单位" })).toBeInTheDocument();
		expect(document.body.textContent ?? "").not.toContain("回合");
	});
});
