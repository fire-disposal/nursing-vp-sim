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
import ScenarioStage from "@/scenario/ScenarioStage";
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
	sseError,
} from "./fixtures";

/**
 * 学生自己的那条消息：**提交瞬间入流**（乐观/待提交），权威视图到达后按稳定身份接替。
 *
 * 用户能看到的只有四件事，这里也只钉这四件：先出现、不重复、失败退场、世界不因失败而改动。
 * 待提交**不是**"已完成"：文本里必须写着它还没提交。
 */

const mocks = vi.hoisted(() => ({
	listScenarioPacks: vi.fn(),
	listMyScenarioSessions: vi.fn(),
	createScenarioSession: vi.fn(),
	getScenarioSession: vi.fn(),
	getScenarioRequest: vi.fn(),
	closeScenarioSession: vi.fn(),
}));

// 只替换网络调用：`streamScenarioTurn` 走真实实现（fetch 被替身接管），SSE 帧的解析才是真的被验证。
vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return { ...actual, ...mocks };
});

/** 可手动推帧的 SSE 响应：`fetch` 每次调用给一条新流，帧按调用序 `push(index, …)`。 */
function sseHarness() {
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

/** SSE 事件必须带**这次请求**的身份：控制台按 `request_id` 收口，别的请求的帧一律不算数。 */
function forRequest(event: ScenarioStreamEvent, requestId: string): ScenarioStreamEvent {
	return { ...event, request_id: requestId };
}

function baseView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return makeView({
		session: { id: 12, status: "active", turn: 1, lost: false, seq: 4, trial: false },
		...overrides,
	});
}

/** 一次成功的行动之后的权威视图：学生的原话在，世界的回应跟在它后面。 */
function committedView(text: string): ScenarioView {
	return makeView({
		session: { id: 12, status: "active", turn: 2, lost: false, seq: 6, trial: false },
		messages: [
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
				text,
				turn: 2,
			}),
			makeMessage({ id: "m2.1", role: "scene", kind: "narration", text: "氧流量 2 升，他的呼吸还是费力。", turn: 2 }),
		],
	});
}

/** 对话流里正文正好是 `text` 的**学生行**（按正文过滤：标签上有同一个对象名不算）。 */
function studentLines(text: string): HTMLElement[] {
	return [...document.querySelectorAll('.sc-lines .sc-line[data-role="student"]')].filter(
		(line) => line.querySelector(".sc-line-text")?.textContent === text,
	) as HTMLElement[];
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
	// 控制台把草稿与未决请求存在 sessionStorage（刷新后续训用）：用例之间必须清干净，
	// 否则上一条用例的"未决请求"会把下一条的发送按钮按成 disabled。
	sessionStorage.clear();
});

afterEach(() => {
	sessionStorage.clear();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("待提交行本身（受控渲染）", () => {
	it("说话类待提交：标签读出对象与「说话」，写明还没提交，且贴在流尾", () => {
		const view = baseView();
		render(
			<ScenarioStage
				view={view}
				pending={{
					requestId: "req-9",
					kind: "speech",
					text: "您现在感觉怎么样？",
					target: { kind: "actor", id: "patient" },
				}}
			/>,
		);

		const line = screen.getByText("您现在感觉怎么样？").closest(".sc-line") as HTMLElement;
		expect(line).toHaveAttribute("data-role", "student");
		expect(line).toHaveAttribute("data-pending", "true");
		expect(within(line).getByText("对 2 床患者 · 说话")).toBeInTheDocument();
		expect(line.textContent).toContain("待提交");

		const turns = [...document.querySelectorAll(".sc-lines .sc-turn")];
		expect(turns[turns.length - 1].querySelector(".sc-line")).toBe(line);
		// 它只是"刚说出口"，不是既成事实：流里的行数 = 权威消息 + 这一条
		expect(document.querySelectorAll(".sc-lines .sc-line")).toHaveLength(
			(view.messages ?? []).length + 1,
		);
	});
});

describe("提交瞬间入流：先出现", () => {
	it("权威视图还没到，他那句话已经在流里（同一结构 + 待提交）", async () => {
		const user = userEvent.setup();
		const harness = sseHarness();
		vi.stubGlobal("fetch", harness.fetchMock);
		await enterSession(user, baseView());

		await submitAction(user, "先给他吸氧。");
		await waitFor(() => expect(harness.requests).toHaveLength(1));

		const pending = studentLines("先给他吸氧。");
		expect(pending).toHaveLength(1);
		expect(pending[0]).toHaveAttribute("data-role", "student");
		expect(pending[0].querySelector(".sc-line-main .sc-line-text")).not.toBeNull();
		expect(pending[0]).toHaveAttribute("data-pending", "true");
		// 对象与"行动"都读得出来；且明写还没提交（不假装已完成）
		expect(pending[0].textContent).toContain("对 2 床患者 · 行动");
		expect(pending[0].textContent).toContain("待提交");
		expect(pending[0].closest(".sc-turn")).toHaveAttribute("data-pending", "true");

		// 世界那边还停在上一段：还没有第 2 段的段落，已有的世界仍然可读
		expect(document.getElementById("sc-turn-2")).toBeNull();
		// 顶栏读的是累计情境时间；说话不消耗时间，所以还是「已过 1 个时间单位」
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toBe("已过 1 个时间单位");
		// 学生会话面里没有「回合」这套旧口径
		expect(document.querySelector(".sc-root")?.textContent).not.toContain("回合");
		const flow = document.querySelector(".sc-lines") as HTMLElement;
		expect(within(flow).getByText("监护仪在响。")).toBeInTheDocument();
		expect(within(flow).queryByText("氧流量 2 升，他的呼吸还是费力。")).toBeNull();
	});
});

describe("权威视图到达：接替，不重复", () => {
	it("原来那一条变成正式消息，不再是待提交，也不会两条并存", async () => {
		const user = userEvent.setup();
		const harness = sseHarness();
		vi.stubGlobal("fetch", harness.fetchMock);
		await enterSession(user, baseView());

		await submitAction(user, "先给他吸氧。");
		await waitFor(() => expect(harness.requests).toHaveLength(1));
		const request = harness.requests[0];
		expect(studentLines("先给他吸氧。")).toHaveLength(1);

		await act(async () => {
			harness.push(
				0,
				forRequest(
					sseCommitted(
						makeTurnResult({
							request_id: request.request_id,
							// 这次提交没让情境时间前进：后端报的 `time_cost` 就是 0
							time_cost: 0,
							view: committedView("先给他吸氧。"),
						}),
					),
					request.request_id,
				),
			);
			harness.close(0);
		});

		await waitFor(() => expect(document.getElementById("sc-turn-2")).not.toBeNull());
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toBe("已过 2 个时间单位");
		// 时间代价如实为 0（`time_cost: 0`）的提交不点亮「本段变化」：又说了句话不等于世界变了
		// （用户裁定 2026-09-29）——判据就是这个类型化字段本身，与提交次数、与段落分组都无关
		expect(document.querySelectorAll(".sc-lines [data-highlight]")).toHaveLength(0);

		const lines = studentLines("先给他吸氧。");
		expect(lines).toHaveLength(1);
		expect(lines[0]).not.toHaveAttribute("data-pending");
		expect(lines[0].textContent).not.toContain("待提交");
		// 顺序照旧：他先做，世界才回应
		const reply = screen.getByText("氧流量 2 升，他的呼吸还是费力。").closest(".sc-line");
		expect(reply).not.toBeNull();
		expect(
			lines[0].compareDocumentPosition(reply as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

describe("时间未前进的失败：退场，世界不变", () => {
	it("待提交行消失，权威视图保持原样，原输入还在", async () => {
		const user = userEvent.setup();
		const harness = sseHarness();
		vi.stubGlobal("fetch", harness.fetchMock);
		await enterSession(user, baseView());

		await submitAction(user, "先给他吸氧。");
		await waitFor(() => expect(harness.requests).toHaveLength(1));
		const request = harness.requests[0];
		expect(studentLines("先给他吸氧。")).toHaveLength(1);

		await act(async () => {
			harness.push(
				0,
				forRequest(sseError("dm_failed", "本次回应没有生成出来，请重试"), request.request_id),
			);
			harness.close(0);
		});

		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

		// 退场：没有半条学生消息留在流里
		expect(studentLines("先给他吸氧。")).toHaveLength(0);
		expect(document.querySelectorAll('.sc-lines .sc-line[data-role="student"]')).toHaveLength(0);
		// 世界没有被改动：还是第 1 段那两条，也没有替学生补一个世界回应
		expect(document.getElementById("sc-turn-2")).toBeNull();
		expect(document.querySelector(".sc-topbar-meta")?.textContent).toBe("已过 1 个时间单位");
		const flow = document.querySelector(".sc-lines") as HTMLElement;
		expect(within(flow).getByText("监护仪在响。")).toBeInTheDocument();
		expect(within(flow).queryByText("氧流量 2 升，他的呼吸还是费力。")).toBeNull();
		// 失败不是学生的错：他打的字还在，不用重打
		expect(screen.getByRole("textbox")).toHaveValue("先给他吸氧。");
	});
});
