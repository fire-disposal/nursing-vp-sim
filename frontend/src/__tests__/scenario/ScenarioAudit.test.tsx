import { notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { Link, MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@/__tests__/render";
import {
	ScenarioHttpError,
	type ScenarioSessionRow,
	type ScenarioStreamEvent,
	type ScenarioTurnRequest,
	type ScenarioTurnResult,
} from "@/api/scenario";
import ScenarioConsole from "@/scenario/ScenarioConsole";
import { startPack } from "./entry";
import { PACK, makeSessionResponse, makeSessionState, makeTurnResult, makeView, sseCommitted } from "./fixtures";
import { chooseTarget } from "./intent";

/**
 * 学生控制台的**边界行为**用例：功能开关、错误口径、在途状态、历史读取失败、
 * 开启反馈、结果播报、会话进地址栏。
 *
 * 只替换网络调用，提交走真实的 `streamScenarioTurn(...)` 调用点（帧由用例推进）——
 * 断言的是"学生看到什么、世界有没有被污染"，不是替身自己回声。
 *
 * 时间语义：`view.session.turn` 是**已过掉的情境时间单位**，界面一律说「时间单位 N」。
 */

const mocks = vi.hoisted(() => ({
	listScenarioPacks: vi.fn(),
	listMyScenarioSessions: vi.fn(),
	createScenarioSession: vi.fn(),
	getScenarioSession: vi.fn(),
	getScenarioRequest: vi.fn(),
	streamScenarioTurn: vi.fn(),
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
		getScenarioRequest: mocks.getScenarioRequest,
		streamScenarioTurn: mocks.streamScenarioTurn,
		closeScenarioSession: mocks.closeScenarioSession,
	};
});

const notFound = (detail = "情境包不存在") => ({
	isAxiosError: true,
	response: { status: 404, data: { detail } },
	message: "Request failed with status code 404",
});

/** 一条被用例手动推进的流（在途状态要能被卡住，才看得到"请求还没落地"的界面）。 */
interface TestStream {
	request: ScenarioTurnRequest;
	emit: (event: ScenarioStreamEvent) => void;
	settle: () => void;
}

// tsconfig 的 lib 停在 ES2022（没有 `Promise.withResolvers` 的类型），沿用仓内既有写法
const promiseConstructor = Promise as unknown as {
	withResolvers<T>(): {
		promise: Promise<T>;
		resolve: (value: T) => void;
		reject: (reason?: unknown) => void;
	};
};

let streams: TestStream[] = [];
/** true = 提交不由默认实现收尾，用例自己发帧、自己收尾。 */
let holdSubmit = false;
/** 这一次提交的世界答复（用例可改 outcome / time_cost / 视图）。 */
let turnResult: ScenarioTurnResult = makeTurnResult();

function baseTurnResult(overrides: Partial<ScenarioTurnResult> = {}): ScenarioTurnResult {
	return makeTurnResult({
		request_id: "req-auto",
		seq: 5,
		turn: 2,
		time_cost: 1,
		outcome: "performed",
		messages: [],
		view: makeView({
			session: { id: 12, status: "active", turn: 2, lost: false, seq: 5, read_only: false, trial: false },
		}),
		...overrides,
	});
}

/** 地址栏探针：MemoryRouter 不改 window.location，所以从路由里读查询串。 */
function LocationProbe() {
	const [params] = useSearchParams();
	return <span data-testid="query">{params.get("session") ?? ""}</span>;
}

/**
 * App 导航的「情境」入口（`SidebarNav` / `BottomTabBar` 里那一条就是这样一个 `Link`）：
 * 指向**不带参数**的 `/scenario`。会话里点它 = 退出这一局回列表。
 */
function renderConsole(entry = "/scenario") {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[entry]}>
				<ScenarioConsole />
				<Link to="/scenario">情境</Link>
				<LocationProbe />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

function historyRow(overrides: Partial<ScenarioSessionRow> = {}): ScenarioSessionRow {
	return {
		id: 99,
		user_id: 1,
		pack_key: PACK.key,
		pack_title: PACK.title,
		pack_revision_id: PACK.revision_id ?? 7,
		status: "active",
		turn: 3,
		lost: false,
		summary: null,
		read_only: false,
		trial: false,
		created_at: "2026-09-27T14:00:00+08:00",
		updated_at: "2026-09-27T14:05:00+08:00",
		...overrides,
	};
}

/** 一次提交：默认立刻以 `committed` 收尾；`holdSubmit = true` 时由用例推进。 */
function streamHarness(_sessionId: number, request: ScenarioTurnRequest, onEvent: (event: ScenarioStreamEvent) => void) {
	if (holdSubmit) {
		const { promise, resolve } = promiseConstructor.withResolvers<void>();
		streams.push({
			request,
			emit: (event) => onEvent({ ...event, request_id: request.request_id }),
			settle: resolve,
		});
		return promise;
	}
	onEvent({ ...sseCommitted({ ...turnResult, request_id: request.request_id }), request_id: request.request_id });
	return Promise.resolve();
}

/** 推进在途的那条流并等界面落地（发帧、收尾一次做完）。 */
async function settleStream(stream: TestStream, event: ScenarioStreamEvent) {
	await act(async () => {
		stream.emit(event);
		stream.settle();
	});
}

/**
 * 默认视图里有两张可接触的床：学生必须先说出对象（不替他猜）。
 * 说话通道的一次提交：选对象 → 打字 → Enter。
 */
async function submitSpeech(user: UserEvent, target: string, text: string) {
	await chooseTarget(user, target);
	await user.type(screen.getByLabelText("你要说的话"), text);
	await user.keyboard("{Enter}");
}

beforeEach(() => {
	streams = [];
	holdSubmit = false;
	turnResult = baseTurnResult();
	// 草稿与在途请求身份存在 sessionStorage 里：不清的话上一个用例的草稿会在下一个用例里复活。
	sessionStorage.clear();
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	mocks.createScenarioSession.mockResolvedValue(makeSessionResponse());
	mocks.getScenarioSession.mockResolvedValue(makeSessionState());
	mocks.getScenarioRequest.mockResolvedValue({ request_id: "req-auto", kind: "turn", state: "unknown", resend_safe: true });
	mocks.streamScenarioTurn.mockImplementation(streamHarness);
});

afterEach(() => {
	cleanup();
	// Mantine 的通知 store 是**模块级全局**：不主动清，上一个用例的 toast 会在下一个用例里复活
	// （表现为凭空多出 role="alert"），这与产品行为无关，是测试卫生问题。
	notifications.clean();
	vi.clearAllMocks();
});

describe("H1：只有 pack 列表 404 才算「功能未开启」", () => {
	it("pack 列表 404 → 仍然是功能未开启的 gate", async () => {
		mocks.listScenarioPacks.mockRejectedValue(notFound("Not Found"));
		renderConsole();
		expect(await screen.findByText("情境训练当前未开启")).toBeInTheDocument();
	});

	it("开启会话时 404（修订没了）→ 普通错误 + 页面还在，绝不变成 gate", async () => {
		const user = userEvent.setup();
		mocks.createScenarioSession.mockRejectedValue(notFound("情境包不存在"));
		renderConsole();
		await startPack(user, PACK.title);

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
		mocks.listMyScenarioSessions.mockResolvedValue([historyRow()]);
		mocks.getScenarioSession.mockRejectedValue(notFound("会话不存在"));
		renderConsole();

		const history = await screen.findByLabelText("我的情境经历");
		await user.click(await within(history).findByRole("button", { name: /术后低氧/ }));

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

		const button = await screen.findByRole("button", { name: /术后低氧/ });
		expect(button).toBeDisabled();
		expect(button).toHaveAccessibleName(`开始「${PACK.title}」`);
		// 不能用还要解释一遍是平台口吻：没有可点的修订就不给一行占位说明，
		// 但这一份病例本身照旧如实列在那里（不可点 ≠ 从列表里消失）
		expect(screen.queryByText(/该病例没有可用修订/)).toBeNull();
		expect(screen.getByText(PACK.one_line)).toBeInTheDocument();

		await user.click(button);
		expect(mocks.createScenarioSession).not.toHaveBeenCalled();
	});
});

describe("H2：失败不把后端原文/机器话吐给学生", () => {
	it("自由输入与表单字段都带上 2000 字上限（粘一段病程不会换来 422）", async () => {
		const user = userEvent.setup();
		// 会话视图来自 GET /sessions/{id}（开启只写地址栏）：要测的形状挂在这一边
		mocks.getScenarioSession.mockResolvedValue(
			makeSessionState({
				view: makeView({
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
							targets: [],
							time_cost: 0,
						},
					],
				}),
			}),
		);
		renderConsole();
		await startPack(user, PACK.title);
		await screen.findByLabelText("表达与行动");

		expect(screen.getByLabelText("你要说的话")).toHaveAttribute("maxlength", "2000");

		// 声明动作（选择型／结构化）带出的表单字段同样有上限
		await user.click(screen.getByRole("button", { name: "记录／选择" }));
		await user.click(await screen.findByRole("button", { name: "写护理记录" }));
		expect(await screen.findByLabelText("观察")).toHaveAttribute("maxlength", "2000");
	});

	it("服务端的人话照原样显示，机器码/JSON 信封不进学生界面，输入保留", async () => {
		const user = userEvent.setup();
		mocks.streamScenarioTurn.mockRejectedValue(
			new ScenarioHttpError(422, {
				code: "unknown_affordance",
				message: "这个动作没有在病例里声明，请换一个。",
				retryable: false,
			}),
		);
		renderConsole();
		await startPack(user, PACK.title);
		await screen.findByLabelText("表达与行动");

		await submitSpeech(user, "2 床患者", "给他吸痰");

		const alerts = await screen.findAllByRole("alert");
		const shown = alerts.map((alert) => alert.textContent ?? "").join(" | ");
		expect(shown).toContain("这个动作没有在病例里声明，请换一个。");
		// 内部错误码与信封形状都不是学生文案
		expect(shown).not.toContain("unknown_affordance");
		expect(document.body.textContent).not.toContain('"code"');
		// 未提交的输入还在，学生改完就能再发
		expect(screen.getByLabelText("你要说的话")).toHaveValue("给他吸痰");
	});
});

describe("H3：在途请求的输入与发送", () => {
	it("请求在途时发送停下（不许再叠一条），草稿留着", async () => {
		const user = userEvent.setup();
		holdSubmit = true;
		renderConsole();
		await startPack(user, PACK.title);
		await screen.findByLabelText("表达与行动");

		const area = await screen.findByLabelText("你要说的话");
		await submitSpeech(user, "2 床患者", "第一句：现在最难受的是什么？");
		await waitFor(() => {
			expect(mocks.streamScenarioTurn).toHaveBeenCalledTimes(1);
		});

		// 在途：发不出去，再点也不会多出一条；草稿仍在（等待不等于清空学生的输入）
		const send = screen.getByRole("button", { name: "发送" });
		expect(send).toBeDisabled();
		await user.click(send);
		expect(mocks.streamScenarioTurn).toHaveBeenCalledTimes(1);
		expect(area).toHaveValue("第一句：现在最难受的是什么？");

		await settleStream(
			streams[0],
			sseCommitted({ ...turnResult, request_id: streams[0].request.request_id }),
		);
		// 落地：世界的时间前进了（顶栏读数跟着走），输入框回收成空草稿
		await waitFor(() => {
			expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
				"已过 2 个时间单位",
			);
		});
		expect(screen.getByLabelText("你要说的话")).toHaveValue("");
	});

	it("没有新输入时照旧清空（原行为不变）", async () => {
		const user = userEvent.setup();
		renderConsole();
		await startPack(user, PACK.title);
		await screen.findByLabelText("表达与行动");

		await submitSpeech(user, "2 床患者", "就问一句");

		await waitFor(() => {
			expect(screen.getByLabelText("你要说的话")).toHaveValue("");
		});
	});
});

describe("M1：历史读取失败不再冒充「没有记录」", () => {
	it("失败给说明 + 重试，不静默留白", async () => {
		const user = userEvent.setup();
		mocks.listMyScenarioSessions.mockRejectedValue({
			isAxiosError: true,
			response: { status: 500, data: {} },
			message: "Request failed with status code 500",
		});
		renderConsole();

		const retry = await screen.findByRole("button", { name: /经历读取失败/ });
		// 入口页照旧可用（历史坏了不代表这一页坏了）
		expect(await screen.findByText(PACK.title)).toBeInTheDocument();

		await user.click(retry);
		await waitFor(() => {
			expect(mocks.listMyScenarioSessions).toHaveBeenCalledTimes(2);
		});
	});
});

describe("M2：开启会话期间有反馈", () => {
	it("等待后端开场时给出可播报的进行中状态", async () => {
		const user = userEvent.setup();
		const start = promiseConstructor.withResolvers<unknown>();
		mocks.createScenarioSession.mockReturnValue(start.promise);
		renderConsole();
		await startPack(user, PACK.title);

		expect(await screen.findByText("正在读取情境…")).toBeInTheDocument();
		await act(async () => {
			start.resolve(makeSessionResponse());
		});
		// 会话就位后那条状态收掉（不留在界面上当装饰）
		await waitFor(() => {
			expect(screen.queryByText("正在读取情境…")).toBeNull();
		});
		expect(await screen.findByLabelText("表达与行动")).toBeInTheDocument();
	});
});

describe("M4：世界答复被播报", () => {
	it("世界答复用时间单位口径播报，不写「第 N 回合」", async () => {
		const user = userEvent.setup();
		renderConsole();
		await startPack(user, PACK.title);
		await screen.findByLabelText("表达与行动");

		await submitSpeech(user, "2 床患者", "给他吸痰");

		await waitFor(() => {
			expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain(
				"时间前进了 1 个单位",
			);
		});
		expect(document.body.textContent).not.toContain("回合");
	});
});

describe("M3：会话进地址栏（?session=）", () => {
	it("直达带 ?session= 时恢复那一局", async () => {
		mocks.getScenarioSession.mockResolvedValue(
			makeSessionState({
				view: makeView({
					session: { id: 12, status: "active", turn: 4, lost: false, seq: 8, read_only: false, trial: false },
				}),
			}),
		);
		renderConsole("/scenario?session=12");

		await waitFor(() => {
			expect(mocks.getScenarioSession).toHaveBeenCalledWith(12);
		});
		await waitFor(() => {
			expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
				"已过 4 个时间单位",
			);
		});
	});

	it("开启会话后地址栏带上 ?session=；点 App 导航的「情境」回列表时清掉", async () => {
		const user = userEvent.setup();
		renderConsole();
		await startPack(user, PACK.title);
		await screen.findByLabelText("表达与行动");

		await waitFor(() => {
			expect(screen.getByTestId("query").textContent).toBe("12");
		});

		// App 导航的「情境」不带 ?session=：会话里再点它 = 退出这一局、回到入口列表
		await user.click(screen.getByRole("link", { name: "情境" }));
		await waitFor(() => {
			expect(screen.getByTestId("query").textContent).toBe("");
		});
		expect(
			await screen.findByRole("heading", { name: "选一个情境开始" }),
		).toBeInTheDocument();
	});
});

describe("L7：失败播报", () => {
	it("动作失败的错误容器能被读屏播报（role=alert），且不吐供应商内部话", async () => {
		const user = userEvent.setup();
		mocks.streamScenarioTurn.mockRejectedValue(
			new ScenarioHttpError(503, {
				code: "provider_unavailable",
				message: "模型服务暂时不可用，稍后可以再试。",
				retryable: true,
			}),
		);
		renderConsole();
		await startPack(user, PACK.title);
		await screen.findByLabelText("表达与行动");

		await submitSpeech(user, "2 床患者", "给他吸痰");

		const alerts = await screen.findAllByRole("alert");
		expect(alerts.some((alert) => alert.textContent?.includes("模型服务暂时不可用"))).toBe(true);
		expect(document.body.textContent).not.toContain("provider_unavailable");
	});
});
