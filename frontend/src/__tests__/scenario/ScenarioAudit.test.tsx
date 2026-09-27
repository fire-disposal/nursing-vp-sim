import { notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioView } from "@/api/scenario";
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
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
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

/**
 * 手动 deferred：本仓的 TS lib 还没到 es2024，`Promise.withResolvers` 类型上不存在，
 * 所以在这里显式拿 resolver（仅测试用）。
 */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const PACK = {
	key: "sputum-ineffective",
	title: "吸痰无效：血氧上不来",
	state: "experimental",
	one_line: "夜班，患者痰多却吸不出来。",
	revision_id: 6,
	revision_no: 6,
};

const notFound = (detail = "情境包不存在") => ({
	isAxiosError: true,
	response: { status: 404, data: { detail } },
	message: "Request failed with status code 404",
});

function makeView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return {
		session: { id: 31, status: "active", turn: 2, lost: false },
		pack: { key: PACK.key, title: PACK.title, player_role: "夜班护士", revision_id: 6 },
		situation: {
			place: "呼吸内科病房",
			time_hint: "凌晨 02:10",
			resources: [],
			visible_cues: [],
			noticed: [],
		},
		actors: [],
		hud: [],
		messages: [{ role: "scene", text: "监护仪在响。", turn: 1 }],
		options: [],
		affordances: [
			{
				id: "suction",
				type: "act",
				label: "吸痰",
				select: "none",
				options: [],
				fields: [],
				free_input: true,
				confirm: false,
			},
		],
		free_input: true,
		timeline: [],
		dims: [],
		nudges: [],
		problems: [],
		...overrides,
	};
}

/** 地址栏探针：MemoryRouter 不改 window.location，所以从路由里读查询串。 */
function LocationProbe() {
	const [params] = useSearchParams();
	return <span data-testid="query">{params.get("session") ?? ""}</span>;
}

function renderConsole(entry = "/scenario") {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[entry]}>
				<ScenarioConsole />
				<LocationProbe />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** 让流式那条路"走不通"，从而确定性地走非流式 /actions（与真实退回路径一致）。 */
function disableStreaming() {
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network")));
}

beforeEach(() => {
	disableStreaming();
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	mocks.createScenarioSession.mockResolvedValue({
		session_id: 31,
		pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
		view: makeView(),
	});
	mocks.postScenarioAction.mockResolvedValue({
		session_id: 31,
		problems: [],
		view: makeView(),
	});
});

afterEach(() => {
	cleanup();
	// Mantine 的通知store是**模块级全局**：不主动清，上一个用例的 toast 会在下一个用例里复活
	// （表现为凭空多出 role="alert"），这与产品行为无关，是测试卫生问题。
	notifications.clean();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("H1：只有 pack 列表 404 才算「功能未开启」", () => {
	it("pack 列表 404 → 仍然是功能未开启的 gate", async () => {
		mocks.listScenarioPacks.mockRejectedValue(notFound("Not Found"));
		renderConsole();
		expect(
			await screen.findByText("情境训练当前未开启"),
		).toBeInTheDocument();
	});

	it("开启会话时 404（修订没了）→ 普通错误 + 页面还在，绝不变成 gate", async () => {
		const user = userEvent.setup();
		mocks.createScenarioSession.mockRejectedValue(notFound("情境包不存在"));
		renderConsole();
		await user.click(await screen.findByText(PACK.title));

		await waitFor(() => {
			expect(mocks.createScenarioSession).toHaveBeenCalled();
		});
		// 页面没被换成无出口的 gate，仍停在可选情境的界面
		expect(screen.queryByText("情境训练当前未开启")).toBeNull();
		expect(document.querySelector('.sc-root[data-view="open"]')).not.toBeNull();
		expect(await screen.findByText(PACK.title)).toBeInTheDocument();
	});

	it("恢复会话时 404（会话/修订没了）→ 也只是普通错误", async () => {
		const user = userEvent.setup();
		mocks.listMyScenarioSessions.mockResolvedValue([
			{
				id: 99,
				pack_key: PACK.key,
				pack_title: PACK.title,
				status: "active",
				turn: 3,
				lost: false,
				summary: null,
				created_at: "2026-09-27T14:00:00+08:00",
				updated_at: "2026-09-27T14:05:00+08:00",
			},
		]);
		mocks.getScenarioSession.mockRejectedValue(notFound("会话不存在"));
		renderConsole();

		const history = await screen.findByLabelText("我的情境经历");
		await user.click(within(history).getByRole("button"));

		await waitFor(() => {
			expect(mocks.getScenarioSession).toHaveBeenCalledWith(99);
		});
		expect(screen.queryByText("情境训练当前未开启")).toBeNull();
		expect(document.querySelector('.sc-root[data-view="open"]')).not.toBeNull();
	});

	it("没有可用修订的包：不可点（也不写一行占位说明）", async () => {
		const user = userEvent.setup();
		mocks.listScenarioPacks.mockResolvedValue([
			{ ...PACK, revision_id: null, revision_no: null },
		]);
		renderConsole();

		const button = await screen.findByRole("button", { name: /吸痰无效/ });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute("aria-disabled", "true");
		// 不能用还要解释一遍是平台口吻：没有可点的修订就不给一行占位说明
		expect(screen.queryByText(/该病例没有可用修订/)).toBeNull();
		expect(within(button).queryByText(PACK.one_line)).toBeNull();

		await user.click(button);
		expect(mocks.createScenarioSession).not.toHaveBeenCalled();
	});
});

describe("H2：校验失败不把后端原文吐给学生", () => {
	it("自由输入与表单字段都带上 2000 字上限（粘一段病程不会换来 422）", async () => {
		const user = userEvent.setup();
		mocks.createScenarioSession.mockResolvedValue({
			session_id: 31,
			pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
			view: makeView({
				options: [
					{ label: "记一条", type: "document", affordance_id: "note", params: {} },
				],
				affordances: [
					{
						id: "note",
						type: "document",
						label: "写护理记录",
						select: "none",
						options: [],
						fields: ["观察"],
						free_input: true,
						confirm: false,
					},
				],
			}),
		});
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		expect(screen.getByLabelText("你要做什么")).toHaveAttribute(
			"maxlength",
			"2000",
		);

		// 提示带出的表单字段同样有上限
		await user.click(screen.getByRole("button", { name: "记一条" }));
		expect(await screen.findByLabelText("观察")).toHaveAttribute(
			"maxlength",
			"2000",
		);
	});

	it("422 的英文 pydantic 句子换成一句人话（学生界面看不到英文/JSON）", async () => {
		const user = userEvent.setup();
		mocks.postScenarioAction.mockRejectedValue({
			isAxiosError: true,
			response: {
				status: 422,
				data: {
					detail: [
						{
							type: "string_too_long",
							loc: ["body", "text"],
							msg: "String should have at most 2000 characters",
						},
					],
				},
			},
			message: "Request failed with status code 422",
		});
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		await user.type(screen.getByLabelText("你要做什么"), "给他吸痰");
		await user.keyboard("{Enter}");

		const alerts = await screen.findAllByRole("alert");
		const shown = alerts.map((alert) => alert.textContent ?? "").join(" | ");
		expect(shown).toContain("提交的内容不合法，请检查后重试");
		// 学生界面任何位置都不该出现后端原文/英文 pydantic 句子
		expect(shown).not.toContain("String should have");
		expect(document.body.textContent).not.toContain("String should have");
	});
});

describe("H3：回合进行中的输入（停下 / 落地后清空）", () => {
	it("回合跑着的时候输入与发送都停下（不许再叠一条）", async () => {
		const user = userEvent.setup();
		const turn = deferred<unknown>();
		mocks.postScenarioAction.mockReturnValue(turn.promise);
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		const area = await screen.findByLabelText("你要做什么");
		await user.type(area, "第一句：现在最难受的是什么？");
		await user.click(screen.getByRole("button", { name: "发送" }));
		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledTimes(1);
		});

		// 回合还没落地：输入与发送都停着，再点也不会多出一条
		expect(area).toBeDisabled();
		const send = screen.getByRole("button", { name: "发送" });
		expect(send).toBeDisabled();
		await user.click(send);
		expect(mocks.postScenarioAction).toHaveBeenCalledTimes(1);

		turn.resolve({ session_id: 31, problems: [], view: makeView() });
		// 落地后输入框恢复可用（学生可以接着做下一步）
		await waitFor(() => {
			expect(screen.getByLabelText("你要做什么")).not.toBeDisabled();
		});
	});

	it("没有新输入时照旧清空（原行为不变）", async () => {
		const user = userEvent.setup();
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		await user.type(await screen.findByLabelText("你要做什么"), "就问一句");
		await user.click(screen.getByRole("button", { name: "发送" }));

		await waitFor(() => {
			expect(
				(screen.getByLabelText("你要做什么") as HTMLTextAreaElement).value,
			).toBe("");
		});
	});
});

describe("M1：历史读取失败不再冒充「没有记录」", () => {
	it("失败给说明 + 重试，不显示空态文案", async () => {
		const user = userEvent.setup();
		mocks.listMyScenarioSessions.mockRejectedValue({
			isAxiosError: true,
			response: { status: 500, data: {} },
			message: "Request failed with status code 500",
		});
		renderConsole();

		expect(await screen.findByText(/情境经历读取失败/)).toBeInTheDocument();
		expect(screen.queryByText(/还没有情境经历/)).toBeNull();

		await user.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => {
			expect(mocks.listMyScenarioSessions).toHaveBeenCalledTimes(2);
		});
	});
});

describe("M2：开启会话期间有反馈", () => {
	it("等待后端开场回合时显示「正在开启情境…」", async () => {
		const user = userEvent.setup();
		const start = deferred<unknown>();
		mocks.createScenarioSession.mockReturnValue(start.promise);
		renderConsole();
		await user.click(await screen.findByText(PACK.title));

		expect(await screen.findByRole("status")).toHaveTextContent("正在开启情境…");
		start.resolve({
			session_id: 31,
			pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
			view: makeView(),
		});
		await waitFor(() => {
			expect(screen.queryByText("正在开启情境…")).toBeNull();
		});
	});
});

describe("M4：回合结束后焦点回到自由通道", () => {
	it("动作落地后 activeElement 是自由通道输入，且回合被播报", async () => {
		const user = userEvent.setup();
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		await user.type(screen.getByLabelText("你要做什么"), "给他吸痰");
		await user.keyboard("{Enter}");

		await waitFor(() => {
			expect(document.activeElement).toBe(
				screen.getByLabelText("你要做什么"),
			);
		});
		// 回合结果有 aria-live 播报（读屏能听到"第 N 回合…"）
		const live = document.querySelector('[aria-live="polite"]');
		expect(live?.textContent).toContain("第 2 回合");
	});
});

describe("M3：会话进地址栏（?session=）", () => {
	it("直达带 ?session= 时恢复那一局", async () => {
		mocks.getScenarioSession.mockResolvedValue({
			session_id: 12,
			status: "active",
			report: null,
			view: makeView({ session: { id: 12, status: "active", turn: 4, lost: false } }),
		});
		renderConsole("/scenario?session=12");

		await waitFor(() => {
			expect(mocks.getScenarioSession).toHaveBeenCalledWith(12);
		});
		await waitFor(() => {
			expect(
				document.querySelector(".sc-topbar-meta")?.textContent,
			).toContain("第 4 回合");
		});
	});

	it("开启会话后地址栏带上 ?session=，回列表时清掉", async () => {
		const user = userEvent.setup();
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		await waitFor(() => {
			expect(screen.getByTestId("query").textContent).toBe("31");
		});
		// 写地址栏**不能**触发一次多余的"深链恢复"（否则刚开好的一局会被自己再恢复一遍）
		expect(mocks.getScenarioSession).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "返回" }));
		await waitFor(() => {
			expect(screen.getByTestId("query").textContent).toBe("");
		});
	});
});

describe("L1/L7：建议上限与失败播报", () => {
	it("DM 建议最多渲染 3 条（模型超产不撑爆提示条）", async () => {
		const user = userEvent.setup();
		mocks.createScenarioSession.mockResolvedValue({
			session_id: 31,
			pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
			view: makeView({
				options: Array.from({ length: 9 }, (_, index) => ({
					label: `建议 ${index + 1}`,
					type: "act",
					affordance_id: null,
					params: {},
					free_input: true,
				})),
			}),
		});
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		expect(screen.getAllByRole("button", { name: /^建议 \d/ })).toHaveLength(3);
		expect(screen.queryByRole("button", { name: "建议 4" })).toBeNull();
	});

	it("动作失败的错误容器能被读屏播报（role=alert）", async () => {
		const user = userEvent.setup();
		mocks.postScenarioAction.mockRejectedValue({
			isAxiosError: true,
			response: { status: 500, data: {} },
			message: "Request failed with status code 500",
		});
		renderConsole();
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");

		await user.type(screen.getByLabelText("你要做什么"), "给他吸痰");
		await user.keyboard("{Enter}");
		const alerts = await screen.findAllByRole("alert");
		expect(alerts.some((a) => a.textContent?.includes("服务端出错"))).toBe(true);
	});
});
