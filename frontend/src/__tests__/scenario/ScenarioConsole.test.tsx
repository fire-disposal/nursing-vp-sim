import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@/__tests__/render";
import type {
	ScenarioStreamEvent,
	ScenarioTurnRequest,
	ScenarioView,
} from "@/api/scenario";
import ScenarioConsole from "@/scenario/ScenarioConsole";
import { startPack } from "./entry";
import { chooseMode, chooseTarget, submitLine } from "./intent";
import {
	PACK,
	makeCloseResponse,
	makeLookup,
	makeMessage,
	makeReport,
	makeSessionResponse,
	makeSessionState,
	makeTurnResult,
	makeView,
	sseCommitted,
	sseDelivery,
	sseError,
	ssePhase,
} from "./fixtures";

/**
 * 控制台：请求身份、冲突处置、断流恢复、只读锁定、复盘入口。
 *
 * 只替换网络调用（`isScenarioUnavailable` 等纯函数走真实实现）；提交走真实的
 * `streamScenarioTurn(...)` 调用点，帧由用例逐条推进——因此断言的是"组件拿这个身份
 * 发了什么、失败后世界有没有被污染"，而不是替身自己回声。
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

/** 一条被用例手动推进（或手动弄断）的流。 */
interface TestStream {
	request: ScenarioTurnRequest;
	emit: (event: ScenarioStreamEvent) => void;
	settle: () => void;
	fail: (error: unknown) => void;
}

/** 默认视图自带的旁白 + 患者台词：多处用它当"世界原有内容"的基线。 */
const BASE_MESSAGES = makeView().messages ?? [];

const SESSION = {
	id: 12,
	status: "active",
	turn: 1,
	lost: false,
	seq: 4,
	read_only: false,
	trial: false,
} as const;

const SESSION_ID = 12;
const TYPED = "我这就去看看他的呼吸。";

let streams: TestStream[] = [];
let sessionState = makeSessionState();

beforeEach(() => {
	streams = [];
	sessionState = makeSessionState();
	sessionStorage.clear();
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	mocks.createScenarioSession.mockResolvedValue(makeSessionResponse());
	mocks.getScenarioSession.mockImplementation(async () => sessionState);
	mocks.getScenarioRequest.mockResolvedValue(makeLookup({ state: "unknown" }));
	mocks.closeScenarioSession.mockResolvedValue(makeCloseResponse());
	mocks.streamScenarioTurn.mockImplementation(
		(
			_sessionId: number,
			request: ScenarioTurnRequest,
			onEvent: (event: ScenarioStreamEvent) => void,
		) =>
			new Promise<void>((resolve, reject) => {
				streams.push({
					request,
					emit: (event) => onEvent(event),
					settle: () => resolve(),
					fail: (error) => reject(error),
				});
			}),
	);
});

afterEach(() => {
	vi.clearAllMocks();
});

function renderPage(entry = `/scenario?session=${SESSION_ID}`) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[entry]}>
				<ScenarioConsole />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/**
 * 帧的 `request_id` 必须与本次尝试一致：别的 id 是"不是本次的回应"，按契约忽略。
 * `committed`/`error` 是流上最后一种帧（后端收尾后 `fetch` 的 Promise 才 resolve），
 * 所以推完就收尾——否则控制台会一直停在"忙碌"，界面上的按钮全是禁用的。
 */
function push(stream: TestStream, event: ScenarioStreamEvent) {
	return act(async () => {
		stream.emit({ ...event, request_id: stream.request.request_id });
		if (event.kind === "committed" || event.kind === "error") stream.settle();
	});
}

/** 已加载的会话 + 一句"说话 → 2 床患者"提交。 */
async function speak(user: UserEvent, text = TYPED): Promise<TestStream> {
	renderPage();
	await screen.findByLabelText("表达与行动");
	await chooseMode(user, "说话");
	await chooseTarget(user, "2 床患者");
	await submitLine(user, text);
	await waitFor(() => expect(streams).toHaveLength(1));
	return streams[0];
}

/** 权威视图：学生那一句 + 一条角色回应（第 2 回合）。 */
function advancedView(studentText: string): ScenarioView {
	return makeView({
		session: { ...SESSION, turn: 2, seq: 6 },
		messages: [
			...BASE_MESSAGES,
			makeMessage({
				id: "m2.0",
				role: "student",
				kind: "speech",
				text: studentText,
				turn: 2,
				target: { kind: "actor", id: "patient" },
				declaration: "say",
				actor: null,
				origin: "student",
			}),
			makeMessage({
				id: "m2.1",
				role: "actor",
				kind: "speech",
				actor: "patient",
				actor_role: "2 床患者",
				text: "我好些了，谢谢你。",
				turn: 2,
			}),
		],
	});
}

const storedRequest = () =>
	JSON.parse(sessionStorage.getItem(`scenario-request:${SESSION_ID}`) ?? "null");
const storedDraft = () =>
	JSON.parse(sessionStorage.getItem(`scenario-draft:${SESSION_ID}`) ?? "null");

describe("入口", () => {
	it("开始一次情境：按 pack 修订开会话，落到会话页并读到视图", async () => {
		const user = userEvent.setup();
		renderPage("/scenario");

		await startPack(user, PACK.title);

		expect(mocks.createScenarioSession).toHaveBeenCalledWith({
			pack_key: PACK.key,
			revision_id: PACK.revision_id,
			trial: false,
		});
		await screen.findByLabelText("表达与行动");
		expect(mocks.getScenarioSession).toHaveBeenCalledWith(SESSION_ID);
		expect(
			within(document.querySelector(".sc-lines") as HTMLElement).getByText(
				"监护仪在响。",
			),
		).toBeInTheDocument();
	});

	it("命名空间 404（功能未开启）显示「未开启」，不报错也不显示读取失败", async () => {
		mocks.listScenarioPacks.mockRejectedValue({
			isAxiosError: true,
			message: "Request failed with status code 404",
			response: { status: 404 },
		});

		renderPage("/scenario");

		expect(await screen.findByText("情境训练当前未开启")).toBeInTheDocument();
		expect(screen.queryByText("情境列表读取失败")).toBeNull();
	});
});

describe("请求身份与草稿", () => {
	it("提交带上 request_id 与当前视图 seq；草稿与未决身份落进 sessionStorage", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);

		expect(stream.request.kind).toBe("speech");
		expect(stream.request.text).toBe(TYPED);
		expect(stream.request.target).toEqual({ kind: "actor", id: "patient" });
		expect(typeof stream.request.request_id).toBe("string");
		expect(stream.request.request_id.length).toBeGreaterThan(0);
		// 过期序号的唯一来源是视图
		expect(stream.request.expected_seq).toBe(SESSION.seq);

		// 刷新/离开后未决的尝试仍认得出自己
		expect(storedRequest().request.request_id).toBe(stream.request.request_id);
		expect(storedRequest().request.expected_seq).toBe(SESSION.seq);
		await waitFor(() => expect(storedDraft().text).toBe(TYPED));
	});

	it("提交中只显示学生自己的待定行，世界不动", async () => {
		const user = userEvent.setup();
		await speak(user);

		const pending = document.querySelector('.sc-turn[data-pending="true"]');
		expect(pending).not.toBeNull();
		expect(within(pending as HTMLElement).getByText(TYPED)).toBeInTheDocument();
		// 未提交：权威消息一条没多
		expect(document.querySelectorAll(".sc-line")).toHaveLength(
			BASE_MESSAGES.length + 1,
		);
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 1 个时间单位",
		);
	});
});

describe("断流与重试：不换身份", () => {
	it("刷新后带着未决请求回来：先按同一身份查询，不重发", async () => {
		const saved: ScenarioTurnRequest = {
			request_id: "req-unconfirmed",
			expected_seq: SESSION.seq,
			kind: "speech",
			text: TYPED,
			target: { kind: "actor", id: "patient" },
			selection: [],
		};
		sessionStorage.setItem(
			`scenario-draft:${SESSION_ID}`,
			JSON.stringify({ text: TYPED, intent: { kind: "speech", target: null } }),
		);
		sessionStorage.setItem(
			`scenario-request:${SESSION_ID}`,
			JSON.stringify({ request: saved, label: "", restoreText: TYPED }),
		);

		renderPage();

		// 未决身份被认出来：只用它查询，**不**重发（重发才可能推进两次世界）
		await waitFor(() =>
			expect(mocks.getScenarioRequest).toHaveBeenCalledWith(
				SESSION_ID,
				saved.request_id,
			),
		);
		expect(mocks.streamScenarioTurn).not.toHaveBeenCalled();
		expect(screen.getByRole("alert").textContent).toMatch(/仍未确认/);
		// 草稿也恢复了（学生不用重打）
		expect(screen.getByRole("textbox", { name: "你要说的话" })).toHaveValue(
			TYPED,
		);
	});

	it("断流后重试复用同一 request_id，expected_seq 取当前视图", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		const requestId = stream.request.request_id;

		// 1. 流断掉：结果未明 → 用**同一身份**查询，而不是新开一次尝试
		stream.fail(new Error("network down"));
		await waitFor(() =>
			expect(mocks.getScenarioRequest).toHaveBeenCalledWith(
				SESSION_ID,
				requestId,
			),
		);
		expect(screen.getByRole("alert").textContent).toMatch(/仍未确认/);

		await user.click(
			screen.getByRole("button", { name: "用原请求重新连接" }),
		);
		await waitFor(() => expect(streams).toHaveLength(2));
		expect(streams[1].request.request_id).toBe(requestId);
		expect(streams[1].request.expected_seq).toBe(SESSION.seq);

		// 2. 这一次被"序号过期"挡住 → 刷新到最新处境
		sessionState = makeSessionState({
			view: makeView({
				session: { ...SESSION, turn: 2, seq: 11 },
				messages: [...BASE_MESSAGES, makeMessage({ id: "m2.0", turn: 2, text: "世界推进了。" })],
			}),
		});
		await push(streams[1], sseError("session_conflict", "序号已过期"));

		await waitFor(() =>
			expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
				"已过 2 个时间单位",
			),
		);
		// 3. 再重试：仍是同一个请求身份，序号是刷新后拿到的可提交基线
		await user.click(screen.getByRole("button", { name: "重试本次" }));
		await waitFor(() => expect(streams).toHaveLength(3));
		expect(streams[2].request.request_id).toBe(requestId);
		expect(streams[2].request.expected_seq).toBe(11);
		expect(streams[2].request.expected_seq).toBe(sessionState.view.session.seq);
	});

	it("连接中断/结果未明：说「正在确认」，不声称成功也不声称失败", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		const requestId = stream.request.request_id;

		stream.fail(new Error("network down"));
		await waitFor(() =>
			expect(mocks.getScenarioRequest).toHaveBeenCalledWith(
				SESSION_ID,
				requestId,
			),
		);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toMatch(/仍未确认/);
		expect(alert.textContent).not.toMatch(/未提交|失败|已提交成功/);
		// 可查询、也可用原请求重连；两者都不换身份
		expect(
			screen.getByRole("button", { name: "查询本次结果" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "用原请求重新连接" }),
		).toBeInTheDocument();
		// 世界没被污染：已提交的回合还是那两条，没有新内容
		expect(
			document.querySelectorAll('.sc-turn[data-turn]:not([data-pending]) .sc-line'),
		).toHaveLength(BASE_MESSAGES.length);
		expect(screen.queryByText("我好些了，谢谢你。")).toBeNull();
		// 学生那句仍以"未确认"的姿态留着（既不算已提交、也不算失败）
		const pending = document.querySelector('.sc-turn[data-pending="true"]');
		expect(pending).not.toBeNull();
		expect(within(pending as HTMLElement).getByText(TYPED)).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "你要说的话" })).toHaveValue(
			TYPED,
		);

		// 查询入口真的再查一次（同一身份）
		await user.click(screen.getByRole("button", { name: "查询本次结果" }));
		await waitFor(() =>
			expect(mocks.getScenarioRequest).toHaveBeenCalledTimes(2),
		);
		expect(mocks.getScenarioRequest).toHaveBeenLastCalledWith(
			SESSION_ID,
			requestId,
		);
	});

	it("in_flight 也是「正在确认本次结果」，不是失败", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		mocks.getScenarioRequest.mockResolvedValue(
			makeLookup({ state: "in_flight", resend_safe: true }),
		);

		stream.fail(new Error("network down"));

		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toMatch(/仍未确认/),
		);
		expect(screen.getByRole("alert").textContent).not.toMatch(/未提交|失败/);
	});

	it("查询回来是 failed：按提交前失败处理，输入与身份都留着", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		const requestId = stream.request.request_id;
		mocks.getScenarioRequest.mockResolvedValue(
			makeLookup({
				state: "failed",
				error: { code: "intent_failed", message: "没能理解这句话", retryable: true },
			}),
		);

		stream.fail(new Error("network down"));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/没能理解这句话/);
		expect(alert.textContent).toMatch(/未提交/);
		expect(alert.textContent).not.toMatch(/仍未确认/);
		expect(screen.getByRole("textbox", { name: "你要说的话" })).toHaveValue(
			TYPED,
		);
		// 同一身份：重试仍然是原来那次尝试
		await user.click(screen.getByRole("button", { name: "重试本次" }));
		await waitFor(() => expect(streams).toHaveLength(2));
		expect(streams[1].request.request_id).toBe(requestId);
	});

	it("查询回来是 committed：直接渲染已存结果，绝不重发", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		const requestId = stream.request.request_id;
		mocks.getScenarioRequest.mockResolvedValue(
			makeLookup({
				state: "committed",
				result: makeTurnResult({
					request_id: requestId,
					turn: 2,
					view: advancedView(TYPED),
				}),
			}),
		);

		stream.fail(new Error("network down"));

		await waitFor(() =>
			expect(screen.getByText("我好些了，谢谢你。")).toBeInTheDocument(),
		);
		expect(mocks.getScenarioRequest).toHaveBeenCalledWith(
			SESSION_ID,
			requestId,
		);
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 2 个时间单位",
		);
		// 恢复不是重发：这个尝试只流式跑过一次
		expect(mocks.streamScenarioTurn).toHaveBeenCalledTimes(1);
		// 已确认的尝试不再挂着身份
		await waitFor(() =>
			expect(sessionStorage.getItem(`scenario-request:${SESSION_ID}`)).toBeNull(),
		);
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("冲突处置", () => {
	it("session_conflict：刷新会话、视图更新、草稿留住，重试仍用同一身份", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		const requestId = stream.request.request_id;

		sessionState = makeSessionState({
			view: makeView({
				session: { ...SESSION, turn: 2, seq: 9 },
				messages: [
					...BASE_MESSAGES,
					makeMessage({ id: "m2.0", turn: 2, text: "世界往前走了。" }),
				],
			}),
		});
		await push(stream, sseError("session_conflict", "序号已过期"));

		// 确实重取了会话（挂载时一次 + 冲突后一次）
		await waitFor(() =>
			expect(mocks.getScenarioSession).toHaveBeenCalledTimes(2),
		);
		expect(screen.getByText("世界往前走了。")).toBeInTheDocument();
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 2 个时间单位",
		);
		expect(screen.getByRole("alert").textContent).toMatch(/已刷新到最新处境/);
		// 草稿不丢（学生不用重打）
		expect(screen.getByRole("textbox", { name: "你要说的话" })).toHaveValue(
			TYPED,
		);
		await waitFor(() => expect(storedDraft().text).toBe(TYPED));

		// 同一个请求身份 + 刷新后的序号
		await user.click(screen.getByRole("button", { name: "重试本次" }));
		await waitFor(() => expect(streams).toHaveLength(2));
		expect(streams[1].request.request_id).toBe(requestId);
		expect(streams[1].request.expected_seq).toBe(9);
	});

	it("request_conflict：下一步换新身份，但输入保留", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		const firstId = stream.request.request_id;

		await push(stream, sseError("request_conflict", "同 id 不同输入"));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/输入已保留/);
		// 身份已作废：没有"重试本次"，存储里的未决身份也清掉
		expect(screen.queryByRole("button", { name: "重试本次" })).toBeNull();
		expect(sessionStorage.getItem(`scenario-request:${SESSION_ID}`)).toBeNull();
		// 输入还在
		expect(screen.getByRole("textbox", { name: "你要说的话" })).toHaveValue(
			TYPED,
		);

		// 再发一次 = 一次新的尝试
		await user.click(screen.getByRole("button", { name: "发送" }));
		await waitFor(() => expect(streams).toHaveLength(2));
		expect(streams[1].request.request_id).not.toBe(firstId);
		expect(streams[1].request.text).toBe(TYPED);
		expect(streams[1].request.expected_seq).toBe(SESSION.seq);
	});

	it("形状类拒绝（未知目标）：换新身份并退回对象选择，不静默换人", async () => {
		const user = userEvent.setup();
		await speak(user);

		await push(
			streams[0],
			sseError("unknown_target", "这个对象不在本包里"),
		);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/未提交/);
		expect(screen.queryByRole("button", { name: "重试本次" })).toBeNull();
		expect(sessionStorage.getItem(`scenario-request:${SESSION_ID}`)).toBeNull();
		// 对象退回未选择，由学生自己重选
		expect(
			(screen.getByLabelText("当前对象（说话或行动的对象）") as HTMLSelectElement)
				.value,
		).toBe("");
		expect(screen.getByRole("textbox", { name: "你要说的话" })).toHaveValue(
			TYPED,
		);
	});
});

describe("失败不污染视图", () => {
	it("error 之后：已提交的消息不变、没有新消息、没有待定气泡", async () => {
		const user = userEvent.setup();
		const stream = await speak(user, "先给他换个半坐位。");

		// 先推一个 delivery：它是**未提交草稿**，不得成为内容
		await push(stream, sseDelivery());
		await push(stream, ssePhase("delivering"));
		expect(screen.queryByText("未提交草稿里的话")).toBeNull();
		expect(document.querySelector(".sc-streaming")?.textContent).toBe(
			"正在生成回应",
		);

		await push(stream, {
			...sseError("delivery_failed", "本次生成失败"),
			request_id: stream.request.request_id,
		});
		stream.settle();

		await waitFor(() =>
			expect(document.querySelector('.sc-turn[data-pending="true"]')).toBeNull(),
		);
		// 权威内容一条没变、一条没多
		expect(
			within(document.querySelector(".sc-lines") as HTMLElement).getByText(
				"监护仪在响。",
			),
		).toBeInTheDocument();
		expect(screen.getByText("我……喘不上气。")).toBeInTheDocument();
		expect(screen.queryByText("未提交草稿里的话")).toBeNull();
		expect(screen.queryByText("我好些了，谢谢你。")).toBeNull();
		expect(document.querySelectorAll(".sc-line")).toHaveLength(
			BASE_MESSAGES.length,
		);
		// 世界没推进、忙碌结束、输入留着、身份留着（可重试同一次）
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 1 个时间单位",
		);
		expect(document.querySelector(".sc-streaming")).toBeNull();
		expect(
			(document.querySelector(".sc-composer") as HTMLElement).dataset.busy,
		).toBeUndefined();
		expect(screen.getByRole("textbox", { name: "你要说的话" })).toHaveValue(
			"先给他换个半坐位。",
		);
		expect(storedRequest().request.request_id).toBe(
			stream.request.request_id,
		);
		expect(screen.getByRole("button", { name: "重试本次" })).toBeInTheDocument();
	});
});

describe("只读与归档", () => {
	it("session_closed：刷新后转只读——没有输入条，说明已结束，仍可看复盘", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		sessionState = makeSessionState({
			view: makeView({
				session: { ...SESSION, status: "completed", turn: 3, seq: 9 },
			}),
			report: makeReport(),
		});

		await push(stream, sseError("session_closed", "这一局已经结束"));

		await waitFor(() =>
			expect(document.querySelector(".sc-note")).not.toBeNull(),
		);
		expect(screen.getByRole("alert").textContent).toMatch(/已经结束/);
		// 只读：没有输入条、没有发送、没有结束动作
		expect(screen.queryByLabelText("表达与行动")).toBeNull();
		expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
		expect(screen.queryByRole("button", { name: "结束本次" })).toBeNull();
		const note = document.querySelector(".sc-note") as HTMLElement;
		expect(note.textContent).toMatch(/已结束/);
		expect(
			within(note).getByRole("button", { name: "查看复盘" }),
		).toBeInTheDocument();
	});

	it("session_archived：旧机制会话只读，并说明归档形状", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);
		sessionState = makeSessionState({
			view: makeView({ session: { ...SESSION, status: "completed", seq: 9 } }),
			report: makeReport(),
			read_only: true,
			archive: { shape_version: 2, ended_reason: "cutover" },
		});

		await push(stream, sseError("session_archived", "本局只读"));

		await waitFor(() =>
			expect(document.querySelector(".sc-note")).not.toBeNull(),
		);
		const note = document.querySelector(".sc-note") as HTMLElement;
		expect(note.textContent).toMatch(/机制切换/);
		expect(note.textContent).toMatch(/已归档/);
		expect(note.textContent).toMatch(/形状 v2/);
		expect(note.textContent).toMatch(/cutover/);
		expect(screen.queryByLabelText("表达与行动")).toBeNull();
		expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
	});
});

describe("结局词不是临床错误", () => {
	it.each([
		["blocked", "未能执行", /没有被执行/, "他不在现场，你的话没有传到。"],
		["unmodeled", "未建模", /不能模拟临床后果/, "这一类尝试还不能模拟临床后果。"],
	] as const)("%s：引擎直出的系统消息为准，不给错误告警", async (outcome, label, announcement, text) => {
		const user = userEvent.setup();
		const stream = await speak(user);
		const systemMessage = makeMessage({
			id: "m2.9",
			role: "system",
			kind: outcome,
			text,
			turn: 2,
			origin: "system",
		});

		await push(
			stream,
			sseCommitted(
				makeTurnResult({
					request_id: stream.request.request_id,
					outcome,
					turn: 2,
					messages: [systemMessage],
					view: makeView({
						session: { ...SESSION, turn: 2, seq: 6 },
						messages: [...BASE_MESSAGES, systemMessage],
					}),
				}),
			),
		);

		// 学生读到的是引擎直出的那一句 + 可读标签
		const line = await screen.findByText(text);
		const systemLine = line.closest('[data-role="system"]') as HTMLElement;
		expect(systemLine).not.toBeNull();
		expect(systemLine.textContent).toContain(label);
		// 诚实的世界回答：不是"你做错了"，所以没有错误告警
		expect(screen.queryByRole("alert")).toBeNull();
		const live = document.querySelector('[aria-live="polite"]')?.textContent ?? "";
		expect(live).toMatch(announcement);
		expect(live).not.toMatch(/错误|失败|未提交/);
		// 学生还能改变行动（没有锁定）
		expect(
			screen.getByRole("button", { name: "发送" }),
		).toBeInTheDocument();
	});
});

describe("时间语义", () => {
	it("纯交流提交：时间没有前进，不高亮任何消息，也不在播报里声称世界变了", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);

		await push(
			stream,
			sseCommitted(
				makeTurnResult({
					request_id: stream.request.request_id,
					// 说话不推进情境时间：后端如实报的 `time_cost` 就是 0
					time_cost: 0,
					turn: 1,
					outcome: "speech",
					view: makeView({
						session: { ...SESSION, turn: 1, seq: 6 },
						messages: [
							...BASE_MESSAGES,
							makeMessage({
								id: "m1.2",
								role: "student",
								kind: "speech",
								text: TYPED,
								turn: 1,
								target: { kind: "actor", id: "patient" },
								declaration: "say",
								actor: null,
								origin: "student",
							}),
						],
					}),
				}),
			),
		);

		// 提交发生了，但时间没推进：没有"这个时间单位的变化"要突出
		expect(document.querySelectorAll('[data-highlight="true"]')).toHaveLength(0);
		expect(document.querySelectorAll(".sc-line[data-highlight]")).toHaveLength(0);
		const live = document.querySelector('[aria-live="polite"]')?.textContent ?? "";
		expect(live).toMatch(/时间没有前进/);
		expect(live).not.toMatch(/时间前进了/);
	});

	it("行动推动了情境时间（`time_cost: 2`）：只点亮那一个时间单位的消息，播报如实读出代价", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);

		await push(
			stream,
			sseCommitted(
				makeTurnResult({
					request_id: stream.request.request_id,
					time_cost: 2,
					seq: 6,
					turn: 2,
					outcome: "performed",
					view: advancedView(TYPED),
				}),
			),
		);

		// 时间确实前进的那一段：时间单位 2 里的两条（学生那句 + 世界的回应）被点亮
		const marked = [...document.querySelectorAll('[data-highlight="true"]')];
		expect(marked).toHaveLength(2);
		expect(
			marked.every(
				(line) => line.closest(".sc-turn")?.getAttribute("data-turn") === "2",
			),
		).toBe(true);
		// 上一个时间单位没有被今天的行动"污染"
		expect(document.querySelectorAll("#sc-turn-1 [data-highlight]")).toHaveLength(0);
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 2 个时间单位",
		);
		const live = document.querySelector('[aria-live="polite"]')?.textContent ?? "";
		expect(live).toMatch(/时间前进了 2 个单位/);
		expect(live).not.toMatch(/时间没有前进/);
	});

	it("行动没让时间前进（`time_cost: 0`）：世界给了回应也没有可突出的变化", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);

		await push(
			stream,
			sseCommitted(
				makeTurnResult({
					request_id: stream.request.request_id,
					time_cost: 0,
					turn: 1,
					outcome: "performed",
					view: makeView({
						session: { ...SESSION, turn: 1, seq: 6 },
						messages: [
							...BASE_MESSAGES,
							makeMessage({
								id: "m1.2",
								role: "student",
								kind: "action",
								text: "我看了看监护仪。",
								turn: 1,
								target: { kind: "actor", id: "patient" },
								declaration: "act",
								actor: null,
								origin: "student",
							}),
							makeMessage({
								id: "m1.3",
								role: "scene",
								kind: "narration",
								text: "血氧仍是 89。",
								turn: 1,
								origin: "world",
							}),
						],
					}),
				}),
			),
		);

		// 新内容落地了，但时间没前进：这个时间单位没有"变化"要突出
		await screen.findByText("血氧仍是 89。");
		expect(document.querySelectorAll('[data-highlight="true"]')).toHaveLength(0);
		expect(document.querySelector("#sc-turn-1 [data-highlight]")).toBeNull();
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 1 个时间单位",
		);
		const live = document.querySelector('[aria-live="polite"]')?.textContent ?? "";
		expect(live).toMatch(/时间没有前进/);
		expect(live).not.toMatch(/时间前进了/);
	});
});

describe("对话流", () => {
	it("按完整时间单位分组：每个时间单位有锚点，学生归属可读，系统消息可辨，不把时间单位当分钟", async () => {
		userEvent.setup();
		sessionState = makeSessionState({
			view: makeView({
				session: { ...SESSION, turn: 3, seq: 9 },
				messages: [
					...BASE_MESSAGES,
					makeMessage({ id: "m2.0", turn: 2, text: "他的呼吸急促起来。" }),
					makeMessage({
						id: "m3.0",
						role: "student",
						kind: "action",
						text: "给他吸痰",
						turn: 3,
						target: { kind: "actor", id: "patient" },
						declaration: "act",
						actor: null,
						origin: "student",
					}),
					makeMessage({
						id: "m3.1",
						role: "system",
						kind: "blocked",
						text: "吸引器没有接上负压。",
						turn: 3,
						origin: "system",
					}),
				],
			}),
		});
		renderPage();

		await screen.findByLabelText("场景画面");
		expect(document.querySelector("#sc-turn-1")).not.toBeNull();
		expect(document.querySelector("#sc-turn-2")).not.toBeNull();
		const turn3 = document.querySelector("#sc-turn-3") as HTMLElement;
		expect(turn3).not.toBeNull();
		expect(turn3.querySelector(".sc-turn-mark")?.textContent).toContain(
			"时间单位 3",
		);
		// 学生那句读得出对象与"行动"
		expect(
			within(turn3).getByText("对 2 床患者 · 行动"),
		).toBeInTheDocument();
		// 引擎直出的系统消息有独立形状与可读标签
		const systemLine = turn3.querySelector('[data-role="system"]') as HTMLElement;
		expect(systemLine).not.toBeNull();
		expect(systemLine.textContent).toContain("未能执行");
		// 时间单位不是分钟，也不是"第几次提交"
		const root = document.querySelector(".sc-root") as HTMLElement;
		expect(root.textContent).not.toMatch(/分钟/);
		expect(root.textContent).not.toMatch(/回合/);
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 3 个时间单位",
		);
	});
});

describe("页头", () => {
	it("资料／回看可开合；未决或忙碌时不给「结束本次」", async () => {
		const user = userEvent.setup();
		await speak(user);

		const side = document.querySelector(".sc-side") as HTMLElement;
		expect(side.dataset.open).toBe("false");
		await user.click(screen.getByRole("button", { name: "资料／回看" }));
		await waitFor(() => expect(side.dataset.open).toBe("true"));
		// 未决的动作与"结束本次"不能抢同一个序号：结束入口此刻不可用
		expect(screen.getByRole("button", { name: "结束本次" })).toBeDisabled();

		// Esc 收起，焦点还给入口（不把人留在空抽屉里）
		await user.keyboard("{Escape}");
		await waitFor(() => expect(side.dataset.open).toBe("false"));
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "资料／回看" }),
		);
	});
});

describe("复盘入口", () => {
	function finishedState(legacyReport: Record<string, unknown> | null = null) {
		return makeSessionState({
			view: makeView({
				session: { ...SESSION, status: "completed", turn: 3, seq: 9, read_only: true },
				messages: [
					...BASE_MESSAGES,
					makeMessage({
						id: "m2.0",
						role: "student",
						kind: "speech",
						text: "我先看看他的呼吸。",
						turn: 2,
						target: { kind: "actor", id: "patient" },
						declaration: "say",
						actor: null,
						origin: "student",
					}),
				],
			}),
			read_only: true,
			report: legacyReport === null ? makeReport() : null,
			legacy_report: legacyReport,
		});
	}

	it("打开已结束的会话：先看到对话，点「查看复盘」才进报告", async () => {
		const user = userEvent.setup();
		sessionState = finishedState();
		renderPage();

		// 先对话
		await screen.findByText("我先看看他的呼吸。");
		expect(screen.queryByLabelText("关键时刻")).toBeNull();

		const note = document.querySelector(".sc-note") as HTMLElement;
		await user.click(within(note).getByRole("button", { name: "查看复盘" }));

		// 再评价：结局与关键时刻
		const keyTurns = await screen.findByLabelText("关键时刻");
		expect(within(keyTurns).getByText("我先看看他的呼吸。")).toBeInTheDocument();
		expect(document.querySelector(".sc-report-sub")?.textContent).toMatch(
			/主动结束/,
		);
		// 报告也是学生面：整块文字里没有引擎口径「回合」，也没有把时间单位当成「分钟」
		const reportSurface = document.querySelector(".sc-report") as HTMLElement;
		expect(reportSurface).not.toBeNull();
		expect(reportSurface.textContent).not.toMatch(/回合/);
		expect(reportSurface.textContent).not.toMatch(/分钟/);
		// 报告页可以退回对话
		await user.click(screen.getByRole("button", { name: "回看对话" }));
		await waitFor(() =>
			expect(document.querySelector(".sc-lines")).not.toBeNull(),
		);
		expect(
			within(document.querySelector(".sc-lines") as HTMLElement).getByText(
				"监护仪在响。",
			),
		).toBeInTheDocument();
		expect(screen.queryByLabelText("关键时刻")).toBeNull();
	});

	it("只有 legacy_report：原样只读展开，不套新报告形状", async () => {
		const user = userEvent.setup();
		const legacy = { anchor_count: 2, score: { rate: 0.5 } };
		sessionState = finishedState(legacy);
		renderPage();

		await screen.findByText("我先看看他的呼吸。");
		const note = document.querySelector(".sc-note") as HTMLElement;
		await user.click(within(note).getByRole("button", { name: "查看复盘" }));

		const section = await screen.findByLabelText("旧机制原报告（原样留档）");
		expect(section.querySelector("pre")?.textContent).toBe(
			JSON.stringify(legacy, null, 2),
		);
		expect(screen.queryByLabelText("关键时刻")).toBeNull();
		expect(screen.queryByLabelText("判读详情")).toBeNull();
	});
});
