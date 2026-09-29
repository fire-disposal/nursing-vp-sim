import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@/__tests__/render";
import type {
	ScenarioStreamEvent,
	ScenarioTurnPhase,
	ScenarioTurnRequest,
} from "@/api/scenario";
import ScenarioConsole from "@/scenario/ScenarioConsole";
import {
	PACK,
	makeCloseResponse,
	makeLookup,
	makeMessage,
	makeSessionState,
	makeTurnResult,
	makeView,
	sseCommitted,
	sseDelivery,
	sseError,
	ssePhase,
} from "./fixtures";
import { chooseMode, chooseTarget, submitLine } from "./intent";

/**
 * SSE 事件处理（`streamScenarioTurn` 的 onEvent 语义）。
 *
 * 走**真实控制台**：只把网络调用换成替身，事件按后端契约逐个推给组件；因此这里证明的
 * 是"组件收到这个帧会怎样呈现"，而不是替身自己回声。
 *
 * 只钉四件事：阶段文案来自真实阶段枚举；`delivery` 是**未提交草稿**，永不成为内容；
 * `committed` 渲染权威视图并结束忙碌；可重试错误保留学生输入。
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

// 只替换网络调用；`isScenarioUnavailable` 等纯函数走真实实现。
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

/** 一条被测试用例手动推进的流：`emit` 推帧，`settle` 让 Promise 收尾。 */
interface TestStream {
	request: ScenarioTurnRequest;
	emit: (event: ScenarioStreamEvent) => void;
	settle: () => void;
}

let streams: TestStream[] = [];
let sessionState = makeSessionState();

beforeEach(() => {
	streams = [];
	sessionState = makeSessionState();
	sessionStorage.clear();
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	mocks.getScenarioSession.mockImplementation(async () => sessionState);
	mocks.getScenarioRequest.mockResolvedValue(makeLookup({ state: "unknown" }));
	mocks.closeScenarioSession.mockResolvedValue(makeCloseResponse());
	mocks.streamScenarioTurn.mockImplementation(
		(
			_sessionId: number,
			request: ScenarioTurnRequest,
			onEvent: (event: ScenarioStreamEvent) => void,
		) =>
			new Promise<void>((resolve) => {
				streams.push({
					request,
					emit: (event) => onEvent(event),
					settle: () => resolve(),
				});
			}),
	);
});

afterEach(() => {
	vi.clearAllMocks();
});

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario?session=12"]}>
				<ScenarioConsole />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** 帧的 `request_id` 必须与本次尝试一致，否则控制台按契约忽略它（不是本次的回应）。 */
function push(stream: TestStream, event: ScenarioStreamEvent) {
	return act(async () => {
		stream.emit({ ...event, request_id: stream.request.request_id });
	});
}

/** 进到某个已加载的会话，并提交一句"说话 → 2 床患者"。 */
async function speak(user: UserEvent, text = "我这就去看看他的呼吸。"): Promise<TestStream> {
	renderPage();
	await screen.findByLabelText("表达与行动");
	await chooseMode(user, "说话");
	await chooseTarget(user, "2 床患者");
	await submitLine(user, text);
	await waitFor(() => expect(streams).toHaveLength(1));
	return streams[0];
}

const BASE_MESSAGES = makeView().messages ?? [];

/** 提交后世界真推进的权威视图：学生那一句 + 一条角色回应。 */
function committedView(studentText: string) {
	return makeView({
		session: {
			id: 12,
			status: "active",
			turn: 2,
			lost: false,
			seq: 6,
			read_only: false,
			trial: false,
		},
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

describe("阶段状态：只给真实阶段", () => {
	it("phase 帧显示该阶段的人话文案", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);

		await push(stream, ssePhase("parsing"));
		expect(document.querySelector(".sc-streaming")?.textContent).toBe(
			"正在理解你的表达",
		);

		await push(stream, ssePhase("validating"));
		expect(document.querySelector(".sc-streaming")?.textContent).toBe(
			"正在校验回应",
		);

		// 提交后不再显示阶段
		await push(
			stream,
			sseCommitted(
				makeTurnResult({
					request_id: stream.request.request_id,
					turn: 2,
					view: committedView("我这就去看看他的呼吸。"),
				}),
			),
		);
		stream.settle();
		await waitFor(() => expect(document.querySelector(".sc-streaming")).toBeNull());
	});

	it("未知阶段原样透传，不自造阶段名", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);

		await push(stream, {
			kind: "phase",
			request_id: "ignored",
			phase: "quantum_phase" as ScenarioTurnPhase,
		});

		// 不认识就不假装认识：不出现任何自造的"正在…"文案
		expect(document.querySelector(".sc-streaming")?.textContent).toBe(
			"quantum_phase",
		);
	});

	it("空阶段不冒充某个具体阶段", async () => {
		const user = userEvent.setup();
		const stream = await speak(user);

		await push(stream, {
			kind: "phase",
			request_id: "ignored",
			phase: "" as ScenarioTurnPhase,
		});

		// 只说明"正在处理"，不指认一个它并不知道的阶段
		const text = document.querySelector(".sc-streaming")?.textContent ?? "";
		expect(text).toMatch(/正在处理/);
		expect(text).not.toMatch(/正在理解|正在结算|正在生成|正在校验|正在提交/);
	});
});

describe("delivery 是未提交草稿", () => {
	const DRAFT_TEXT = "未提交草稿里的话";

	it("delivery 帧的文本永不进入 DOM（包括 delivery→error 的失败尝试）", async () => {
		const user = userEvent.setup();
		const stream = await speak(user, "帮他坐起来一点。");

		// 提交中：显示的是学生自己的待定行（不是世界已发生的事）
		const pending = document.querySelector('.sc-turn[data-pending="true"]');
		expect(pending).not.toBeNull();
		expect(
			within(pending as HTMLElement).getByText("帮他坐起来一点。"),
		).toBeInTheDocument();

		await push(stream, sseDelivery());
		expect(screen.queryByText(DRAFT_TEXT)).toBeNull();
		// 草稿不当事实：待定行还在，世界没有新内容
		expect(document.querySelector('.sc-turn[data-pending="true"]')).not.toBeNull();

		await push(stream, {
			...sseError("delivery_failed", "本次生成失败"),
			request_id: stream.request.request_id,
		});
		stream.settle();

		// 失败后：草稿仍未出现，待定行收走，错误说明"未提交"
		await waitFor(() =>
			expect(document.querySelector('.sc-turn[data-pending="true"]')).toBeNull(),
		);
		expect(screen.queryByText(DRAFT_TEXT)).toBeNull();
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toMatch(/未提交/);
		expect(alert.textContent).toMatch(/输入已保留/);
	});
});

describe("committed 渲染权威视图", () => {
	it("权威消息替换待定行，时间前进，忙碌态结束，草稿随成功清空", async () => {
		const user = userEvent.setup();
		const stream = await speak(user, "我这就去看看他的呼吸。");

		// 提交中：忙碌 + 待定行
		expect(
			(document.querySelector(".sc-composer") as HTMLElement).dataset.busy,
		).toBe("true");
		expect(document.querySelector('.sc-turn[data-pending="true"]')).not.toBeNull();

		await push(
			stream,
			sseCommitted(
				makeTurnResult({
					request_id: stream.request.request_id,
					turn: 2,
					view: committedView("我这就去看看他的呼吸。"),
				}),
			),
		);
		stream.settle();

		// 权威视图：世界回应出现，学生那一句带对象与"说话"归属
		await waitFor(() =>
			expect(screen.getByText("我好些了，谢谢你。")).toBeInTheDocument(),
		);
		expect(
			within(screen.getByLabelText("场景画面")).getByText("对 2 床患者 · 说话"),
		).toBeInTheDocument();
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 2 个时间单位",
		);
		// 接替而不是重复：待定行收走，同一句只出现一次
		expect(document.querySelector('.sc-turn[data-pending="true"]')).toBeNull();
		expect(
			screen
				.getByLabelText("场景画面")
				.textContent?.match(/我这就去看看他的呼吸。/g),
		).toHaveLength(1);
		// 忙碌态结束（阶段文案消失、输入条解锁）
		expect(document.querySelector(".sc-streaming")).toBeNull();
		await waitFor(() =>
			expect(
				(document.querySelector(".sc-composer") as HTMLElement).dataset.busy,
			).toBeUndefined(),
		);
		// 同一段文字提交成功后草稿才清空
		expect(
			screen.getByRole("textbox", { name: "你要说的话" }),
		).toHaveValue("");
	});
});

describe("可重试错误", () => {
	it("保留输入并向学生提供重试（不改世界）", async () => {
		const user = userEvent.setup();
		const stream = await speak(user, "先给他换个半坐位。");

		await push(stream, {
			...sseError("provider_unavailable", "供应商暂时不可用"),
			request_id: stream.request.request_id,
		});
		stream.settle();

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/未提交/);
		// 输入还在（学生可以直接重试，不用重打）
		expect(
			screen.getByRole("textbox", { name: "你要说的话" }),
		).toHaveValue("先给他换个半坐位。");
		expect(
			screen.getByRole("button", { name: "重试本次" }),
		).toBeInTheDocument();
		// 世界没动：时间没有前进，也没有新回应
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toContain(
			"已过 1 个时间单位",
		);
		expect(screen.getByLabelText("场景画面").textContent).not.toContain(
			"我好些了",
		);
	});
});
