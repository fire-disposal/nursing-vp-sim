import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioAdminAsset, ScenarioAdminPack, ScenarioPackContent } from "@/api/scenario";
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

// 断言的是"界面说了什么"，不是通知库的渲染细节。
vi.mock("@/components/Toast", () => ({
	toast: {
		success: mocks.toastSuccess,
		error: mocks.toastError,
		warning: mocks.toastError,
		info: mocks.toastSuccess,
		apiError: mocks.toastError,
	},
}));

const mocks = vi.hoisted(() => ({
	listAdminScenarioPacks: vi.fn(),
	uploadAdminScenarioPack: vi.fn(),
	uploadAdminScenarioAsset: vi.fn(),
	replaceAdminScenarioAsset: vi.fn(),
	deleteAdminScenarioAsset: vi.fn(),
	deleteAdminScenarioPack: vi.fn(),
	duplicateAdminScenarioPack: vi.fn(),
	listAdminScenarioSessions: vi.fn(),
	getAdminScenarioSession: vi.fn(),
	getAdminScenarioStats: vi.fn(),
	createBlankScenarioPack: vi.fn(),
	getAdminScenarioPackContent: vi.fn(),
	publishAdminScenarioPack: vi.fn(),
	unpublishAdminScenarioPack: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		listAdminScenarioPacks: mocks.listAdminScenarioPacks,
		uploadAdminScenarioPack: mocks.uploadAdminScenarioPack,
		uploadAdminScenarioAsset: mocks.uploadAdminScenarioAsset,
		replaceAdminScenarioAsset: mocks.replaceAdminScenarioAsset,
		deleteAdminScenarioAsset: mocks.deleteAdminScenarioAsset,
		deleteAdminScenarioPack: mocks.deleteAdminScenarioPack,
		duplicateAdminScenarioPack: mocks.duplicateAdminScenarioPack,
		listAdminScenarioSessions: mocks.listAdminScenarioSessions,
		getAdminScenarioSession: mocks.getAdminScenarioSession,
		getAdminScenarioStats: mocks.getAdminScenarioStats,
		createBlankScenarioPack: mocks.createBlankScenarioPack,
		getAdminScenarioPackContent: mocks.getAdminScenarioPackContent,
		publishAdminScenarioPack: mocks.publishAdminScenarioPack,
		unpublishAdminScenarioPack: mocks.unpublishAdminScenarioPack,
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
		one_line: "术后第二天，患者呼吸费力。",
		// 图片声明进内容会让版本 +1：用这个当"上传前后"的可观察差别
		version: uploaded ? 4 : 3,
		published: true,
		published_at: "2026-09-29T12:00:00Z",
		assets: [asset(uploaded)],
		overview: {
			player_role: "夜班护士",
			place: "呼吸内科病房",
			time_hint: "凌晨 02:10",
			resources: ["床旁吸引器"],
			actors: [{ id: "patient", role: "患者", presence: "on_site" }],
			cues: 6,
			affordances: 8,
			devices: 2,
			facts: 3,
			criteria: 5,
			criteria_weight: 100,
			failure: "irreversible",
		},
		sessions: 2,
	};
}

/** 这份病例的当前内容（`GET .../content`）。 */
function packContent(overrides: Partial<ScenarioPackContent> = {}): ScenarioPackContent {
	return {
		key: PACK_KEY,
		title: "术后低氧",
		one_line: "术后第二天，患者呼吸费力。",
		version: 3,
		published: true,
		published_at: "2026-09-29T12:00:00Z",
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
		changed: false,
		...overrides,
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
async function openCase(user: UserEvent) {
	await user.click(await screen.findByRole("button", { name: "进入工作区" }));
	await screen.findByRole("button", { name: "返回病例列表" });
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
	mocks.getAdminScenarioPackContent.mockResolvedValue(packContent());
	mocks.createBlankScenarioPack.mockResolvedValue({
		key: "night-shift-2",
		version: 1,
		created: true,
		assets_pending: [],
	});
	mocks.duplicateAdminScenarioPack.mockResolvedValue({
		key: "night-shift-2",
		version: 1,
		created: true,
		assets_pending: [],
	});
	mocks.deleteAdminScenarioPack.mockResolvedValue({
		key: PACK_KEY,
		deleted_assets: 1,
	});
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
				"这个页面需要「病例内容管理」或「数据查看」权限：前者管病例与图片，后者看会话与统计。",
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
		expect(screen.queryByRole("tab", { name: "编辑" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "图片" })).toBeNull();
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
		expect(screen.getByRole("tab", { name: "编辑" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "图片" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "会话" })).toBeNull();
		expect(mocks.listAdminScenarioSessions).not.toHaveBeenCalled();
	});

	it("数据区的块按名字可达（会话 / 统计），且哪一个在被读由 aria-selected 表达", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ScenarioAdminPage />);

		await user.click(await screen.findByRole("radio", { name: "会话 / 统计" }));
		for (const name of ["会话", "统计"]) {
			expect(screen.getByRole("tab", { name })).toBeInTheDocument();
		}
		expect(screen.getByRole("tab", { name: "会话" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		// 归档跟着病例模型的简化一起没了：它不再是数据区的块
		expect(screen.queryByRole("tab", { name: "归档" })).toBeNull();
	});
});

describe("管理侧：病例选择只有一处、清单只有一份", () => {
	it("从列表进工作区：头部就是病例本身，块里没有第二个病例选择器", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ScenarioAdminPage />);

		await openCase(user);
		// 头部：病例名 + 版本 + 上架状态 + 返回
		const head = document.querySelector(".sc-admin-case-head") as HTMLElement;
		expect(within(head).getByText("术后低氧")).toBeInTheDocument();
		expect(within(head).getByText(/版本 #3/)).toBeInTheDocument();
		expect(within(head).getByText("已上架")).toBeInTheDocument();
		expect(
			within(head).getByRole("button", { name: "返回病例列表" }),
		).toBeInTheDocument();

		// 「图片」块里没有病例下拉（旧的重复选择器就长在这里）
		await user.click(screen.getByRole("tab", { name: "图片" }));
		expect(screen.queryByLabelText("按病例筛选")).toBeNull();

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
		await user.click(screen.getByRole("tab", { name: "图片" }));
		await user.click(screen.getByRole("tab", { name: "编辑" }));
		await user.click(screen.getByRole("tab", { name: "概览" }));

		await waitFor(() => {
			expect(mocks.listAdminScenarioPacks).toHaveBeenCalledTimes(1);
		});
	});

	it("地址栏带着病例：刷新/直达直接落在它的工作区；返回列表清掉参数", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<ScenarioAdminPage />,
			`/scenario-admin?case=${PACK_KEY}&block=editor`,
		);

		expect(await screen.findByRole("button", { name: "返回病例列表" })).toBeInTheDocument();
		expect(await screen.findByRole("tab", { name: "编辑" })).toHaveAttribute(
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
	it("上传成功 → 图片进病例、工作区头部与图片清单都变已上传", async () => {
		const user = userEvent.setup();
		let uploaded = false;
		mocks.listAdminScenarioPacks.mockImplementation(() =>
			Promise.resolve([pack(uploaded)]),
		);
		mocks.uploadAdminScenarioAsset.mockImplementation(() => {
			uploaded = true;
			return Promise.resolve({ key: PACK_KEY, asset: asset(true) });
		});

		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);
		await user.click(await screen.findByRole("tab", { name: "图片" }));

		const before = await screen.findByRole("row", { name: /a_room/ });
		expect(within(before).getByText("未上传")).toBeInTheDocument();
		expect(within(before).getByRole("button", { name: "预览" })).toBeDisabled();

		await attachFile(
			user,
			new File([new Uint8Array([137, 80, 78, 71])], "room.png", {
				type: "image/png",
			}),
		);
		await user.type(screen.getByLabelText(/图片编号/), "a_room");
		await user.click(screen.getByRole("button", { name: "上传并保存" }));

		await waitFor(() => {
			expect(mocks.uploadAdminScenarioAsset).toHaveBeenCalled();
		});
		const [key, payload] = mocks.uploadAdminScenarioAsset.mock.calls[0];
		expect(key).toBe(PACK_KEY);
		expect(payload.asset_id).toBe("a_room");
		expect(payload.file).toBeInstanceOf(File);

		// 清单重新取一次：同一个病例的那一条现在有字节了（头部版本号也跟着变）
		const after = await screen.findByRole("row", { name: /a_room/ });
		await waitFor(() => {
			expect(within(after).getByText("已上传")).toBeInTheDocument();
		});
		expect(within(after).queryByText("未上传")).toBeNull();
		expect(within(after).getByRole("button", { name: "预览" })).toBeEnabled();
		// 工作区头部与图片块说的是同一个版本号（一份真源，不是两处各记一个）
		expect(screen.getAllByText(/版本 #4/).length).toBeGreaterThan(0);
	});

	it("已上传的图换一张：走 replace（asset_id 在路径上），不是再上传一次", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioPacks.mockResolvedValue([pack(true)]);
		mocks.replaceAdminScenarioAsset.mockResolvedValue({ key: PACK_KEY, asset: asset(true) });

		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);
		await user.click(await screen.findByRole("tab", { name: "图片" }));

		const row = await screen.findByRole("row", { name: /a_room/ });
		await user.click(within(row).getByRole("button", { name: "替换图片" }));

		const dialog = await screen.findByRole("dialog");
		const modalInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
		await user.upload(
			modalInput,
			new File([new Uint8Array([1, 2, 3])], "new.png", { type: "image/png" }),
		);
		await user.click(within(dialog).getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(mocks.replaceAdminScenarioAsset).toHaveBeenCalled();
		});
		const [key, assetId, payload] = mocks.replaceAdminScenarioAsset.mock.calls[0];
		expect(key).toBe(PACK_KEY);
		expect(assetId).toBe("a_room");
		expect(payload.file).toBeInstanceOf(File);
		expect(mocks.uploadAdminScenarioAsset).not.toHaveBeenCalled();
	});

	it("删除图片要二次确认，确认后调用删除", async () => {
		const user = userEvent.setup();
		mocks.listAdminScenarioPacks.mockResolvedValue([pack(true)]);
		mocks.deleteAdminScenarioAsset.mockResolvedValue({
			key: PACK_KEY,
			version: 5,
			assets: [asset(false)],
		});

		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);
		await user.click(await screen.findByRole("tab", { name: "图片" }));

		const row = await screen.findByRole("row", { name: /a_room/ });
		await user.click(within(row).getByRole("button", { name: "删除" }));
		expect(
			await screen.findByText(/删除后，这个病例里不再有「病房环境」（编号 a_room）/),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "确认删除" }));

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
					pack_version: 3,
					status: "completed",
					turn: 4,
					lost: false,
					summary: { strong: 1, adequate: 0, missed: 0 },
					trial: false,
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
				pack_version: 3,
				status: "completed",
				turn: 4,
				lost: false,
				summary: { strong: 1, adequate: 0, missed: 0 },
				trial: false,
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
					pack_version: 3,
					status: "completed",
					turn: 4,
					lost: false,
					summary: { strong: 1, adequate: 0, missed: 0 },
					trial: false,
					created_at: "2026-09-27T01:00:00Z",
					updated_at: "2026-09-27T01:30:00Z",
				},
			],
		});
		renderWithProviders(<ScenarioAdminPage />);
		await openCase(user);

		for (const name of ["概览", "编辑", "图片", "会话"]) {
			await user.click(await screen.findByRole("tab", { name }));
			expect(document.body.textContent ?? "").not.toContain("回合");
		}
		await user.click(await screen.findByRole("tab", { name: "统计" }));
		expect(document.body.textContent ?? "").not.toContain("回合");

		// 回到「会话」：turn 落在这张表的列头
		await user.click(screen.getByRole("tab", { name: "会话" }));
		expect(
			await screen.findByRole("columnheader", { name: "时间单位" }),
		).toBeInTheDocument();

		// 跨病例区看同一次会话，口径一致
		await user.click(screen.getByRole("radio", { name: "会话 / 统计" }));
		expect(screen.getByRole("columnheader", { name: "时间单位" })).toBeInTheDocument();
		expect(document.body.textContent ?? "").not.toContain("回合");
	});
});

describe("管理侧：上架/下架是学生可见性的唯一入口", () => {
	it("未上架的病例：列表里明说「未上架」，一键上架调 publish（要二次确认）", async () => {
		const user = userEvent.setup();
		const draft = pack(false);
		draft.published = false;
		draft.published_at = null;
		mocks.listAdminScenarioPacks.mockResolvedValue([draft]);
		mocks.publishAdminScenarioPack.mockResolvedValue({ ...draft, published: true });

		renderWithProviders(<ScenarioAdminPage />);

		expect(await screen.findByText("未上架")).toBeInTheDocument();
		await user.click(within(await screen.findByRole("row", { name: /术后低氧/ })).getByRole("button", { name: "上架" }));
		expect(mocks.publishAdminScenarioPack).not.toHaveBeenCalled();
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText(/把「术后低氧」上架？/)).toBeInTheDocument();
		await user.click(within(dialog).getByRole("button", { name: "上架" }));
		await waitFor(() => {
			expect(mocks.publishAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY);
		});
	});

	it("已上架的病例：入口是「下架」，调的是 unpublish", async () => {
		const user = userEvent.setup();
		mocks.unpublishAdminScenarioPack.mockResolvedValue({ ...pack(false), published: false });

		renderWithProviders(<ScenarioAdminPage />);

		expect(await screen.findByText("已上架")).toBeInTheDocument();
		await user.click(within(await screen.findByRole("row", { name: /术后低氧/ })).getByRole("button", { name: "下架" }));
		const dialog = await screen.findByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: "下架" }));
		await waitFor(() => {
			expect(mocks.unpublishAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY);
		});
	});
});

describe("管理侧：病例的系统侧闭环（新建 / 复制 / 删除）", () => {
	it("新建空白病例：表单给出 key/标题，提交走 blank 接口（新建的病例是未上架的）", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ScenarioAdminPage />);

		await user.type(await screen.findByLabelText("病例 key"), "night-shift-2");
		await user.type(screen.getByLabelText("标题"), "夜班第二例");
		await user.click(screen.getByRole("button", { name: "新建" }));
		await waitFor(() => {
			expect(mocks.createBlankScenarioPack).toHaveBeenCalledWith({
				key: "night-shift-2",
				title: "夜班第二例",
			});
		});
	});

	it("复制病例：填新 key/标题，提交走 duplicate（源病例的当前内容成为新病例的第 1 版）", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ScenarioAdminPage />);

		await user.click(within(await screen.findByRole("row", { name: /术后低氧/ })).getByRole("button", { name: "复制" }));
		const dialog = await screen.findByRole("dialog");
		const keyInput = within(dialog).getByLabelText("新病例 key");
		await user.clear(keyInput);
		await user.type(keyInput, "sputum-copy");
		const titleInput = within(dialog).getByLabelText("新病例标题");
		await user.clear(titleInput);
		await user.type(titleInput, "吸痰无效（变式）");
		await user.click(within(dialog).getByRole("button", { name: "复制" }));

		await waitFor(() => {
			expect(mocks.duplicateAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY, {
				key: "sputum-copy",
				title: "吸痰无效（变式）",
			});
		});
	});

	it("没有会话的病例：删除要二次确认，确认后调 delete", async () => {
		const user = userEvent.setup();
		const fresh = pack(false);
		fresh.sessions = 0;
		mocks.listAdminScenarioPacks.mockResolvedValue([fresh]);

		renderWithProviders(<ScenarioAdminPage />);

		await user.click(within(await screen.findByRole("row", { name: /术后低氧/ })).getByRole("button", { name: "删除" }));
		expect(mocks.deleteAdminScenarioPack).not.toHaveBeenCalled();
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText(/删除「术后低氧」？/)).toBeInTheDocument();
		await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

		await waitFor(() => {
			expect(mocks.deleteAdminScenarioPack).toHaveBeenCalledWith(PACK_KEY);
		});
	});

	it("已有会话的病例：删除按钮禁用，并在行上说明原因（可下架但不可删除）", async () => {
		renderWithProviders(<ScenarioAdminPage />);

		const row = await screen.findByRole("row", { name: /术后低氧/ });
		expect(within(row).getByRole("button", { name: "删除" })).toBeDisabled();
		expect(within(row).getByText(/已有 2 局记录，可下架但不可删除/)).toBeInTheDocument();
		// 下架这条路仍然通着（删除被禁不代表整个病例动不了）
		expect(within(row).getByRole("button", { name: "下架" })).toBeEnabled();
		expect(mocks.deleteAdminScenarioPack).not.toHaveBeenCalled();
	});

	it("后端仍返回 409 pack_has_sessions：照原话转述，不翻译成「删除失败请重试」", async () => {
		const user = userEvent.setup();
		const fresh = pack(false);
		fresh.sessions = 0;
		mocks.listAdminScenarioPacks.mockResolvedValue([fresh]);
		mocks.deleteAdminScenarioPack.mockRejectedValue({
			response: {
				status: 409,
				data: {
					detail: {
						code: "pack_has_sessions",
						message: "这个病例已有 3 局记录，可下架但不可删除",
						sessions: 3,
					},
				},
			},
		});

		renderWithProviders(<ScenarioAdminPage />);
		await user.click(within(await screen.findByRole("row", { name: /术后低氧/ })).getByRole("button", { name: "删除" }));
		await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "确认删除" }));

		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		const [message] = mocks.toastError.mock.calls[0] as [string];
		expect(message).toContain("这个病例已有 3 局记录，可下架但不可删除");
	});

	it("上传病例 JSON：请求体只有 file（没有备注字段）", async () => {
		const user = userEvent.setup();
		mocks.uploadAdminScenarioPack.mockResolvedValue({
			key: PACK_KEY,
			version: 4,
			created: true,
			assets_pending: ["a_missing"],
		});

		renderWithProviders(<ScenarioAdminPage />);
		await screen.findByRole("button", { name: "上传" });
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		await user.upload(
			input,
			new File(["{}"], "pack.json", { type: "application/json" }),
		);
		await user.click(screen.getByRole("button", { name: "上传" }));

		await waitFor(() => {
			expect(mocks.uploadAdminScenarioPack).toHaveBeenCalled();
		});
		// 请求体只有 file：备注（note）已经不在契约里，屏幕上也没有那个输入框
		const [payload] = mocks.uploadAdminScenarioPack.mock.calls[0] as [{ file: File }];
		expect(payload).toEqual({ file: expect.any(File) });
		expect(Object.keys(payload)).toEqual(["file"]);
		expect(screen.queryByLabelText(/备注/)).toBeNull();
	});
});
