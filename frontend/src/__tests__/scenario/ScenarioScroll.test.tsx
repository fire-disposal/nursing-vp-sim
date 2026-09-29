import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@/__tests__/render";
import type {
	ScenarioStreamEvent,
	ScenarioTurnRequest,
	ScenarioView,
} from "@/api/scenario";
import ScenarioConsole from "@/scenario/ScenarioConsole";
import { startPack } from "./entry";
import { chooseMode, chooseTarget } from "./intent";
import {
	PACK,
	makeMessage,
	makeSessionResponse,
	makeSessionState,
	makeTurnResult,
	makeView,
	sseCommitted,
} from "./fixtures";

/**
 * 对话流滚动：**新回应跟着走，但不抢学生正在读的地方**（`docs/23` §7.5/§7.6）。
 *
 * jsdom 没有排版，所以把台词流的高度量出来（`stubMetrics`），"有没有贴底"才是真断言；
 * "有新回应"入口由组件自己给，这里只按用户能看到的按钮名找它。
 */

const mocks = vi.hoisted(() => ({
	listScenarioPacks: vi.fn(),
	listMyScenarioSessions: vi.fn(),
	createScenarioSession: vi.fn(),
	getScenarioSession: vi.fn(),
	getScenarioRequest: vi.fn(),
	closeScenarioSession: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return { ...actual, ...mocks };
});

/** jsdom 没有排版：把台词流的高度量出来，让"是否贴底"这件事可被真实断言。 */
function stubMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
	let top = 0;
	Object.defineProperty(el, "scrollHeight", { get: () => scrollHeight, configurable: true });
	Object.defineProperty(el, "clientHeight", { get: () => clientHeight, configurable: true });
	Object.defineProperty(el, "scrollTop", {
		get: () => top,
		set: (value: number) => {
			top = value;
		},
		configurable: true,
	});
	return {
		get top() {
			return top;
		},
	};
}

/** 可手动推帧的 SSE 响应：`fetch` 每次调用给一条新流，帧按调用序 `push(index, …)`。 */
interface SseHarness {
	requests: ScenarioTurnRequest[];
	fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	push: (index: number, event: ScenarioStreamEvent) => void;
	close: (index: number) => void;
}

function sseHarness(): SseHarness {
	const encoder = new TextEncoder();
	const requests: ScenarioTurnRequest[] = [];
	const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
	const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		requests.push(JSON.parse(String(init?.body ?? "{}")) as ScenarioTurnRequest);
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controllers.push(controller);
			},
		});
		return new Response(stream, {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		});
	});
	return {
		requests,
		fetchMock,
		push(index: number, event: ScenarioStreamEvent) {
			controllers[index].enqueue(
				encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`),
			);
		},
		close(index: number) {
			controllers[index].close();
		},
	};
}

/** 推一次「本段已提交」：帧里必须带**这次请求**的身份，否则控制台不认。 */
async function commit(harness: SseHarness, index: number, view: ScenarioView) {
	const request = harness.requests[index];
	const event = sseCommitted(
		makeTurnResult({ request_id: request.request_id, turn: view.session.turn, view }),
	);
	await act(async () => {
		harness.push(index, { ...event, request_id: request.request_id });
		harness.close(index);
	});
}

function baseView(): ScenarioView {
	return makeView({
		session: { id: 12, status: "active", turn: 1, lost: false, seq: 4, read_only: false, trial: false },
	});
}

/** 第 2（或 3）个时间单位的权威视图：每段 = 学生原话 + 世界回应。 */
function afterTurn(turn: number, reply: string): ScenarioView {
	const messages = [
		makeMessage({ id: "m1.0", role: "scene", kind: "narration", text: "监护仪在响。", turn: 1 }),
		makeMessage({
			id: "m1.1",
			role: "actor",
			kind: "speech",
			actor: "patient",
			actor_role: "2 床患者",
			text: "我……喘不上气。",
			turn: 1,
		}),
		makeMessage({
			id: "m2.0",
			role: "student",
			kind: "action",
			declaration: "act",
			target: { kind: "actor", id: "patient" },
			text: "先给他吸氧。",
			turn: 2,
		}),
		makeMessage({ id: "m2.1", role: "scene", kind: "narration", text: reply, turn: 2 }),
	];
	if (turn >= 3) {
		messages.push(
			makeMessage({
				id: "m3.0",
				role: "student",
				kind: "speech",
				declaration: "say",
				target: { kind: "actor", id: "patient" },
				text: "问问他疼不疼。",
				turn: 3,
			}),
			makeMessage({ id: "m3.1", role: "scene", kind: "narration", text: "他摇摇头，说不出话。", turn: 3 }),
		);
	}
	return makeView({
		session: {
			id: 12,
			status: "active",
			turn,
			lost: false,
			seq: 4 + turn * 2,
			read_only: false,
			trial: false,
		},
		messages,
	});
}

function renderConsole() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario"]}>
				<ScenarioConsole />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

async function enterSession(user: UserEvent, view: ScenarioView) {
	mocks.createScenarioSession.mockResolvedValue(
		makeSessionResponse({ session_id: view.session.id, view }),
	);
	mocks.getScenarioSession.mockResolvedValue(
		makeSessionState({ session_id: view.session.id, view }),
	);
	renderConsole();
	await startPack(user, PACK.title);
	await screen.findByLabelText("表达与行动");
}

/** 学生先选对象、再表达：行动 + 2 床患者 + 一句话 → 发送。 */
async function submitAction(user: UserEvent, text: string) {
	await chooseMode(user, "行动");
	await chooseTarget(user, "2 床患者");
	await user.type(screen.getByRole("textbox", { name: "要尝试的行动" }), text);
	await user.click(screen.getByRole("button", { name: "发送" }));
}

beforeEach(() => {
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	// 草稿与未决请求存在 sessionStorage：用例之间必须清干净（见 ScenarioPendingBubble 的说明）。
	sessionStorage.clear();
});

afterEach(() => {
	sessionStorage.clear();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("台词流滚动", () => {
	it("贴底时新回应把视图带到最新一段", async () => {
		const user = userEvent.setup();
		const harness = sseHarness();
		vi.stubGlobal("fetch", harness.fetchMock);
		await enterSession(user, baseView());

		const lines = document.querySelector(".sc-lines") as HTMLElement;
		const metrics = stubMetrics(lines, 300, 100);
		// 学生的视口本来在底部附近（距底 -50px，判定阈值是 48px）
		lines.scrollTop = 250;
		fireEvent.scroll(lines);

		await submitAction(user, "先给他吸氧。");
		await waitFor(() => expect(harness.requests).toHaveLength(1));
		await commit(harness, 0, afterTurn(2, "氧流量 2 升，他的呼吸还是费力。"));

		await waitFor(() => expect(metrics.top).toBe(300));
		expect(screen.queryByRole("button", { name: /有新回应/ })).toBeNull();
	});

	it("学生向上翻阅时不抢滚动：位移不动，给「有新回应」入口，点它回到最新一段", async () => {
		const user = userEvent.setup();
		const harness = sseHarness();
		vi.stubGlobal("fetch", harness.fetchMock);
		await enterSession(user, baseView());

		const lines = document.querySelector(".sc-lines") as HTMLElement;
		const metrics = stubMetrics(lines, 300, 100);
		// 学生已经翻到上面：距底 190px（> 48）→ 不再跟随
		lines.scrollTop = 10;
		fireEvent.scroll(lines);

		await submitAction(user, "先给他吸氧。");
		await waitFor(() => expect(harness.requests).toHaveLength(1));
		await commit(harness, 0, afterTurn(2, "氧流量 2 升，他的呼吸还是费力。"));

		await screen.findByText("氧流量 2 升，他的呼吸还是费力。");
		// 正在读的那一段没有被新回应拽走
		expect(metrics.top).toBe(10);
		const jump = await screen.findByRole("button", { name: /有新回应/ });

		await user.click(jump);
		expect(metrics.top).toBe(300);
		expect(screen.queryByRole("button", { name: /有新回应/ })).toBeNull();
		// 回到最新一段之后，新一段的内容就在视野里
		expect(screen.getByText("先给他吸氧。")).toBeInTheDocument();
	});

	it("回应到达不强拉焦点：输入框不会被塞回焦点（手机键盘也不该自己弹起来）", async () => {
		const user = userEvent.setup();
		const harness = sseHarness();
		vi.stubGlobal("fetch", harness.fetchMock);
		await enterSession(user, baseView());

		// 进入训练不自动聚焦
		expect(screen.getByRole("textbox")).not.toHaveFocus();

		await submitAction(user, "先给他吸氧。");
		await waitFor(() => expect(harness.requests).toHaveLength(1));
		(document.activeElement as HTMLElement | null)?.blur();

		await commit(harness, 0, afterTurn(2, "氧流量 2 升，他的呼吸还是费力。"));
		await screen.findByText("氧流量 2 升，他的呼吸还是费力。");

		const area = screen.getByRole("textbox");
		expect(area).not.toHaveFocus();
		expect(document.activeElement).not.toBe(area);
	});
});
