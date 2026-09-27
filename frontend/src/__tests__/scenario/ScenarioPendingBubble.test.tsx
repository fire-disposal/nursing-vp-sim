import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@/__tests__/render";
import type { ScenarioView } from "@/api/scenario";
import ScenarioConsole from "@/scenario/ScenarioConsole";
import { chooseCustomAction } from "./intent";

/**
 * 学生自己的气泡：**提交瞬间入流**（待定/乐观），权威 `view` 到达后由正式消息无缝接管。
 *
 * 修复的是交互感错位：此前他要盯着"正在生成…"看几秒，对话流里没有自己那句话，
 * 像发进了虚空。这里按用户能看到的四件事验收：先出现、不重复、失败回滚、确认前不出现。
 */

const mocks = vi.hoisted(() => ({
	listScenarioPacks: vi.fn(),
	listMyScenarioSessions: vi.fn(),
	createScenarioSession: vi.fn(),
	getScenarioSession: vi.fn(),
	postScenarioAction: vi.fn(),
	closeScenarioSession: vi.fn(),
}));

// 只替换网络调用；流式走真实实现（fetch 被替身接管），退回策略也才是真的被验证
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

const PACK = {
	key: "sputum-ineffective",
	title: "吸痰无效：血氧上不来",
	state: "experimental",
	one_line: "夜班，患者痰多却吸不出来。",
	revision_id: 6,
	revision_no: 6,
};

function makeView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return {
		session: { id: 51, status: "active", turn: 1, lost: false },
		pack: {
			key: PACK.key,
			title: PACK.title,
			player_role: "夜班护士",
			revision_id: 6,
		},
		situation: {
			place: "呼吸内科病房",
			time_hint: "凌晨 02:10",
			resources: [],
			visible_cues: [],
			noticed: [],
		},
		actors: [{ id: "patient", role: "患者", presence: "on_site", present: true }],
		hud: [],
		messages: [{ role: "scene", text: "监护仪在响。", turn: 1 }],
		options: [],
		affordances: [],
		free_input: true,
		timeline: [],
		dims: [],
		nudges: [],
		problems: [],
		...overrides,
	};
}

/** 可手动推块的 SSE 响应替身：能精确控制"什么时候到哪一块"。 */
function sseResponse() {
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	return {
		response: new Response(stream, {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		}),
		push(payload: unknown) {
			controller.enqueue(
				encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
			);
		},
		close() {
			controller.close();
		},
	};
}

async function enterSession(user: UserEvent, view: ScenarioView) {
	mocks.createScenarioSession.mockResolvedValue({
		session_id: view.session.id,
		pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
		view,
	});
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario"]}>
				<ScenarioConsole />
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await user.click(await screen.findByText(PACK.title));
	await screen.findByLabelText("动作区");
}

/** 自由表达：先声明「自定义行动」，再写内容并回车（与既有 `ScenarioStream.test.tsx` 同一条路径）。 */
async function submitFree(user: UserEvent, text: string) {
	await chooseCustomAction(user);
	await user.type(screen.getByLabelText("你要做什么"), text);
	await user.keyboard("{Enter}");
}

/**
 * 对话流里文案正好是 `text` 的**学生气泡**。
 *
 * 按 `.sc-lines` 收口、且按 `data-role="student"` 过滤：选项/按钮上可能有同一串字，
 * 那不是"他这句话进流了"。返回条数就是验收要看的"几条"。
 */
function studentBubbles(text: string): Element[] {
	const lines = document.querySelector(".sc-lines");
	if (lines === null) return [];
	return [...lines.querySelectorAll('.sc-line[data-role="student"]')].filter(
		(line) => line.textContent === text,
	);
}

/** 权威回合：`view` 事件是整回合的唯一真相（与后端 `router.py` 的 `send({"kind": "view"})` 同形）。 */
function viewEvent(view: ScenarioView) {
	return { kind: "view", session_id: view.session.id, problems: [], view };
}

beforeEach(() => {
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	mocks.createScenarioSession.mockResolvedValue({
		session_id: 51,
		pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
		view: makeView(),
	});
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("学生气泡：提交瞬间入流（先于权威 view）", () => {
	it("权威 view 还没到，他那句话已经在对话流里（与正式气泡同构 + 待定态）", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse.response));
		await enterSession(user, makeView());

		await submitFree(user, "我先看看瞳孔。");

		const bubbles = studentBubbles("我先看看瞳孔。");
		expect(bubbles).toHaveLength(1);
		// 与正式学生气泡同一结构：右对齐那一套 class + 内层文本节点
		expect(bubbles[0]).toHaveAttribute("data-role", "student");
		expect(bubbles[0].querySelector(".sc-line-main .sc-line-text")).not.toBeNull();
		// 待定态只是"轻一点"，不给"发送中…"这类世界里不存在的字
		expect(bubbles[0]).toHaveAttribute("data-pending", "true");
		expect(screen.queryByText(/发送中/)).toBeNull();
		// 此刻世界那边还是"正在生成…"（他的话已经先到了）
		expect(screen.getByText("正在生成…")).toBeInTheDocument();

		await act(async () => {
			sse.push(viewEvent(makeView()));
			sse.close();
		});
	});

	it("权威 view 到达：该文案只有一条学生气泡，且不再是待定态", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse.response));
		await enterSession(user, makeView());

		await submitFree(user, "我先看看瞳孔。");
		expect(studentBubbles("我先看看瞳孔。")).toHaveLength(1);
		const pendingNode = studentBubbles("我先看看瞳孔。")[0];

		await act(async () => {
			sse.push(
				viewEvent(
					makeView({
						session: { id: 51, status: "active", turn: 2, lost: false },
						messages: [
							{ role: "scene", text: "监护仪在响。", turn: 1 },
							{ role: "student", text: "我先看看瞳孔。", turn: 2 },
							{ role: "scene", text: "瞳孔等大等圆，对光反射在。", turn: 2 },
						],
					}),
				),
			);
			sse.close();
		});

		const topbar = document.querySelector(".sc-topbar-meta") as HTMLElement;
		await waitFor(() => {
			expect(topbar.textContent).toContain("第 2 回合");
		});

		// 防重复：待定的与正式的**不会**同时出现
		const bubbles = studentBubbles("我先看看瞳孔。");
		expect(bubbles).toHaveLength(1);
		expect(bubbles[0]).not.toHaveAttribute("data-pending");
		// 接管是"同一条"：回合同文案预测对了 → key 不变 → React 复用同一个 DOM 节点，
		// 不重挂、不重播 160ms 入场动画（这是"无缝"的字面含义）
		expect(bubbles[0]).toBe(pendingNode);
		// 顺序照旧：他先做，世界才回应
		const scene = [
			...document.querySelectorAll('.sc-line[data-role="scene"] .sc-subtitle'),
		].find((node) => node.textContent === "瞳孔等大等圆，对光反射在。");
		expect(scene).not.toBeUndefined();
		expect(
			bubbles[0].compareDocumentPosition(scene as Element) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

describe("学生气泡：失败回滚", () => {
	it("流式失败 → 待定气泡退场，原话回到输入框", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse.response));
		await enterSession(user, makeView());

		await submitFree(user, "给他吸痰");
		expect(studentBubbles("给他吸痰")).toHaveLength(1);
		// 那句话已经变成气泡：框里先清空（失败才还回去）
		expect(screen.getByLabelText("你要做什么")).toHaveValue("");

		await act(async () => {
			sse.push({ kind: "error", message: "本回合生成中断，请重试" });
			sse.close();
		});

		expect(
			await screen.findByRole("button", { name: "重试" }),
		).toBeInTheDocument();
		expect(studentBubbles("给他吸痰")).toHaveLength(0);
		expect(screen.getByLabelText("你要做什么")).toHaveValue("给他吸痰");
	});

	it("重试成功后重新入流（同一个待定档，不必从头猜文案）", async () => {
		const user = userEvent.setup();
		const first = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(first.response));
		await enterSession(user, makeView());

		await submitFree(user, "给他吸痰");
		await act(async () => {
			first.push({ kind: "error", message: "本回合生成中断，请重试" });
			first.close();
		});
		expect(studentBubbles("给他吸痰")).toHaveLength(0);

		const second = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(second.response));
		await user.click(screen.getByRole("button", { name: "重试" }));
		expect(studentBubbles("给他吸痰")).toHaveLength(1);

		await act(async () => {
			second.push(viewEvent(makeView()));
			second.close();
		});
	});

	it("重试不回填旧的还原：学生已经改了框里那一句，就保留他自己写的", async () => {
		const user = userEvent.setup();
		const first = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(first.response));
		await enterSession(user, makeView());

		await submitFree(user, "给他吸痰");
		await act(async () => {
			first.push({ kind: "error", message: "本回合生成中断，请重试" });
			first.close();
		});
		expect(screen.getByLabelText("你要做什么")).toHaveValue("给他吸痰");

		// 他没急着重试，先把自己那句改掉
		const area = screen.getByLabelText("你要做什么");
		await user.clear(area);
		await user.type(area, "再看看血氧");

		const second = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(second.response));
		await user.click(screen.getByRole("button", { name: "重试" }));
		// 重试发的仍是那一件事（气泡=待定文案），框里那句是他的、不动
		expect(studentBubbles("给他吸痰")).toHaveLength(1);
		expect(screen.getByLabelText("你要做什么")).toHaveValue("再看看血氧");

		await act(async () => {
			second.push({ kind: "error", message: "本回合生成中断，请重试" });
			second.close();
		});
		expect(studentBubbles("给他吸痰")).toHaveLength(0);
		expect(screen.getByLabelText("你要做什么")).toHaveValue("再看看血氧");
	});
});

describe("学生气泡：二次确认", () => {
	it("confirm: true 的动作在用户确认之前**不**入流，确认之后才入流", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		const fetchMock = vi.fn().mockResolvedValue(sse.response);
		vi.stubGlobal("fetch", fetchMock);
		await enterSession(
			user,
			makeView({
				options: [
					{
						label: "立即停止输液",
						type: "act",
						affordance_id: "stop_infusion",
						params: {},
					},
				],
				affordances: [
					{
						id: "stop_infusion",
						type: "act",
						label: "停止输液",
						select: "none",
						options: [],
						fields: [],
						free_input: true,
						confirm: true,
					},
				],
			}),
		);

		await user.click(screen.getByRole("button", { name: /立即停止输液/ }));

		// 二次确认还在问：还没提交，流里不该有这句话
		expect(await screen.findByText("这个动作不可逆。")).toBeInTheDocument();
		expect(studentBubbles("立即停止输液")).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "继续" }));

		expect(studentBubbles("立即停止输液")).toHaveLength(1);
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		await act(async () => {
			sse.push(viewEvent(makeView()));
			sse.close();
		});
	});
});
