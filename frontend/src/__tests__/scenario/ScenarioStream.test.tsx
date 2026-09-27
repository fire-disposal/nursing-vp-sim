import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@/__tests__/render";
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
		pack: { key: PACK.key, title: PACK.title, player_role: "夜班护士", revision_id: 6 },
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
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
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

/** 新模型下提交一个动作：自由输入条是唯一入口（Enter 发送）。 */
async function submitAction(user: UserEvent, text = "给他吸痰") {
	await user.type(screen.getByLabelText("你要做什么"), text);
	await user.keyboard("{Enter}");
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

describe("块级增量渲染", () => {
	it("叙述块先到就先渲染，权威 view 到了再校正", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		const fetchMock = vi.fn().mockResolvedValue(sse.response);
		vi.stubGlobal("fetch", fetchMock);
		await enterSession(user, makeView());

		await submitAction(user);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toContain(
			"/api/scenario/sessions/51/actions/stream",
		);

		// 第一块：只有叙述（不是整回合）
		await act(async () => {
			sse.push({ kind: "blocks", blocks: { narration: "他把身体前倾，抓住床沿。" } });
		});
		expect(await screen.findByText("他把身体前倾，抓住床沿。")).toBeInTheDocument();
		// 此刻还没有台词/按钮 → 说明渲染确实是"先到先渲染"
		expect(screen.queryByText("我喘不上气……")).toBeNull();
		expect(screen.getByText("正在生成…")).toBeInTheDocument();

		// 第二块：台词 + 选项
		await act(async () => {
			sse.push({
				kind: "blocks",
				blocks: {
					lines: [{ actor: "patient", text: "我喘不上气……" }],
					options: [{ label: "加大氧流量", type: "act", affordance_id: "suction" }],
				},
			});
		});
		expect(await screen.findByText("我喘不上气……")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /加大氧流量/ })).toBeInTheDocument();

		// 权威 view：覆盖展示，并结束"进行中"
		await act(async () => {
			sse.push({
				kind: "view",
				session_id: 51,
				problems: [],
				view: makeView({
					session: { id: 51, status: "active", turn: 2, lost: false },
					messages: [
						{ role: "scene", text: "监护仪在响。", turn: 1 },
						{ role: "scene", text: "他从被子里伸手抓住床沿。", turn: 2 },
						{
							role: "actor",
							actor: "patient",
							actor_role: "患者",
							ephemeral: false,
							avatar_seed: "patient",
							text: "我喘不上气……",
							origin: "dm",
						},
					],
				}),
			});
			sse.close();
		});

		// 权威内容出现（第 2 回合），草稿里那句被替换掉
		const topbar = document.querySelector(".sc-topbar-meta") as HTMLElement;
		await waitFor(() => {
			expect(topbar.textContent).toContain("第 2 回合");
		});
		expect(screen.getByText("他从被子里伸手抓住床沿。")).toBeInTheDocument();
		expect(screen.queryByText("他把身体前倾，抓住床沿。")).toBeNull();
		await waitFor(() => {
			expect(screen.queryByText("正在生成…")).toBeNull();
		});
	});

	it("同一 key 再来 = 更新（按新值渲染）", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse.response));
		await enterSession(user, makeView());
		await submitAction(user);

		await act(async () => {
			sse.push({ kind: "blocks", blocks: { narration: "第一版旁白。" } });
		});
		expect(await screen.findByText("第一版旁白。")).toBeInTheDocument();

		await act(async () => {
			sse.push({ kind: "blocks", blocks: { narration: "修正后的旁白。" } });
		});
		expect(await screen.findByText("修正后的旁白。")).toBeInTheDocument();
		expect(screen.queryByText("第一版旁白。")).toBeNull();

		await act(async () => {
			sse.push({ kind: "view", session_id: 51, problems: [], view: makeView() });
			sse.close();
		});
	});

	it("error 事件：保留已渲染内容，并给「重试」入口", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse.response));
		await enterSession(user, makeView());
		await submitAction(user);

		await act(async () => {
			sse.push({ kind: "blocks", blocks: { narration: "已经写出来的半句旁白。" } });
		});
		await act(async () => {
			sse.push({ kind: "error", message: "本回合生成中断，请重试" });
			sse.close();
		});

		expect(await screen.findByText("本回合生成中断，请重试")).toBeInTheDocument();
		// 已渲染的内容**保留**（错误不擦屏）
		expect(screen.getByText("已经写出来的半句旁白。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();

		// 重试走同一条流式端点
		const second = sseResponse();
		const fetchMock = vi.fn().mockResolvedValue(second.response);
		vi.stubGlobal("fetch", fetchMock);
		await user.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
		await act(async () => {
			second.push({ kind: "view", session_id: 51, problems: [], view: makeView() });
			second.close();
		});
		await waitFor(() => {
			expect(screen.queryByText("本回合生成中断，请重试")).toBeNull();
		});
	});

	it("上一局的流式中断提示不会带进下一局", async () => {
		const user = userEvent.setup();
		const first = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(first.response));
		await enterSession(user, makeView());
		await submitAction(user);
		await act(async () => {
			first.push({ kind: "error", message: "本回合生成中断，请重试" });
			first.close();
		});
		expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument();

		// 回到列表 → 重开一局：提示必须消失（否则新局一进来就像刚失败过）
		await user.click(screen.getByRole("button", { name: "我的情境" }));
		mocks.createScenarioSession.mockResolvedValue({
			session_id: 77,
			pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
			view: makeView({ session: { id: 77, status: "active", turn: 0, lost: false } }),
		});
		await user.click(await screen.findByText(PACK.title));
		await screen.findByLabelText("动作区");
		expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
		expect(screen.queryByText("本回合生成中断，请重试")).toBeNull();
	});

	it("流式不可用（没有可读流）→ 自动退回非流式 /actions，行为与今天一致", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
		);
		mocks.postScenarioAction.mockResolvedValue({
			session_id: 51,
			problems: [],
			view: makeView({
				session: { id: 51, status: "active", turn: 2, lost: false },
				messages: [{ role: "scene", text: "退回非流式之后的旁白。", turn: 2 }],
			}),
		});
		await enterSession(user, makeView());

		await submitAction(user);

		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(51, {
				type: "ask",
				text: "给他吸痰",
			});
		});
		expect(await screen.findByText("退回非流式之后的旁白。")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("端点 404（未开启流式）→ 同样退回非流式", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
		);
		mocks.postScenarioAction.mockResolvedValue({
			session_id: 51,
			problems: [],
			view: makeView({ messages: [{ role: "scene", text: "非流式兜底。", turn: 2 }] }),
		});
		await enterSession(user, makeView());

		await submitAction(user);
		expect(await screen.findByText("非流式兜底。")).toBeInTheDocument();
		expect(mocks.postScenarioAction).toHaveBeenCalledTimes(1);
	});

	it("上翻时不抢滚动：流式里新块到达也不动 scrollTop", async () => {
		const user = userEvent.setup();
		const sse = sseResponse();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse.response));
		await enterSession(user, makeView());

		const lines = document.querySelector(".sc-lines") as HTMLElement;
		let top = 0;
		Object.defineProperty(lines, "scrollHeight", { get: () => 300, configurable: true });
		Object.defineProperty(lines, "clientHeight", { get: () => 100, configurable: true });
		Object.defineProperty(lines, "scrollTop", {
			get: () => top,
			set: (value: number) => {
				top = value;
			},
			configurable: true,
		});

		// 学生先往上翻（距底 190px > 48px 阈值）
		lines.scrollTop = 10;
		fireEvent.scroll(lines);

		await submitAction(user);
		await act(async () => {
			sse.push({ kind: "blocks", blocks: { narration: "流式来的第一段旁白。" } });
		});
		await screen.findByText("流式来的第一段旁白。");
		expect(top).toBe(10);

		await act(async () => {
			sse.push({ kind: "view", session_id: 51, problems: [], view: makeView() });
			sse.close();
		});
	});
});
