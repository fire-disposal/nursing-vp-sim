import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/__tests__/render";
import type { ScenarioView } from "@/api/scenario";
import ScenarioConsole from "@/scenario/ScenarioConsole";
import { startPack } from "./entry";
import { chooseCustomAction } from "./intent";

const mocks = vi.hoisted(() => ({
	listScenarioPacks: vi.fn(),
	listMyScenarioSessions: vi.fn(),
	createScenarioSession: vi.fn(),
	getScenarioSession: vi.fn(),
	postScenarioAction: vi.fn(),
	closeScenarioSession: vi.fn(),
}));

vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"@/api/scenario",
	);
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
	player_role: "夜班护士",
	place: "呼吸内科病房",
};

/** jsdom 没有排版：把台词流的高度量出来，让"是否贴底"这件事可被真实断言。 */
function stubMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
	let top = 0;
	Object.defineProperty(el, "scrollHeight", {
		get: () => scrollHeight,
		configurable: true,
	});
	Object.defineProperty(el, "clientHeight", {
		get: () => clientHeight,
		configurable: true,
	});
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

function makeView(turns: number): ScenarioView {
	return {
		session: { id: 41, status: "active", turn: turns, lost: false },
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
		actors: [],
		hud: [],
		messages: Array.from({ length: turns + 1 }, (_, index) => ({
			role: "scene" as const,
			text: `第 ${index} 条旁白：${"很长的一行".repeat(20)}`,
			turn: index + 1,
		})),
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
	};
}

async function enterSession(user: UserEvent) {
	mocks.createScenarioSession.mockResolvedValue({
		session_id: 41,
		pack: { key: PACK.key, title: PACK.title, revision_id: 6 },
		view: makeView(1),
	});
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario"]}>
				<ScenarioConsole />
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await startPack(user, PACK.title);
	await screen.findByLabelText("动作区");
}

async function act(user: UserEvent, view: ScenarioView) {
	mocks.postScenarioAction.mockResolvedValue({
		session_id: 41,
		problems: [],
		view,
	});
	// 新模型只有自由输入条一个入口：先声明意图（Enter 发送）
	await chooseCustomAction(user);
	await user.type(screen.getByLabelText("你要做什么"), "给他吸痰");
	await user.keyboard("{Enter}");
	await screen.findByText(`第 ${view.messages.length - 1} 条旁白：${"很长的一行".repeat(20)}`);
}

beforeEach(() => {
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("台词流滚动：新消息跟随，向上翻阅不抢", () => {
	it("贴底时新消息自动滚到底；向上翻阅后新消息不抢滚动；回到底部恢复跟随", async () => {
		const user = userEvent.setup();
		await enterSession(user);
		const lines = document.querySelector(".sc-lines") as HTMLElement;
		// scrollHeight 300 / clientHeight 100：有 200px 可滚，判定阈值 48px
		const metrics = stubMetrics(lines, 300, 100);

		// 贴底（默认）→ 新消息把视图滚到底
		await act(user, makeView(2));
		expect(metrics.top).toBe(300);

		// 学生自己往上翻：距底 190px（> 48）→ 视为不再跟随
		lines.scrollTop = 10;
		fireEvent.scroll(lines);
		await act(user, makeView(3));
		expect(metrics.top).toBe(10);

		// 翻回底部（距底 0）→ 恢复跟随
		lines.scrollTop = 200;
		fireEvent.scroll(lines);
		await act(user, makeView(4));
		expect(metrics.top).toBe(300);
	});
});
