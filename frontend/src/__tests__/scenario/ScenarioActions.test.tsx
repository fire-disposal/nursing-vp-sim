import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioView } from "@/api/scenario";
import { render, screen, waitFor } from "@/__tests__/render";
import { OTHER_ENTRY_LABEL } from "@/scenario/AffordanceForm";
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
	key: "triage-hidden-bleed",
	title: "分诊台上的犹豫",
	state: "experimental",
	one_line: "他能走，但他脸色不对。",
	revision_id: 9,
	revision_no: 5,
};

function makeView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return {
		session: { id: 21, status: "active", turn: 1, lost: false },
		pack: {
			key: PACK.key,
			title: PACK.title,
			player_role: "分诊护士",
			revision_id: 9,
		},
		situation: {
			place: "急诊分诊台",
			time_hint: "19:40",
			resources: [],
			visible_cues: [],
			noticed: [],
		},
		actors: [{ id: "patient", role: "患者", presence: "on_site", present: true }],
		hud: [],
		messages: [{ role: "scene", text: "他自己走进来的。", turn: 1 }],
		options: [],
		affordances: [
			{
				id: "triage_red",
				type: "act",
				label: "直接分到红区",
				select: "none",
				options: [],
				fields: [],
				free_input: true,
				confirm: true,
			},
			{
				id: "triage_yellow",
				type: "act",
				label: "分到黄区观察",
				select: "none",
				options: [],
				fields: [],
				free_input: true,
				confirm: false,
			},
			{
				id: "write_note",
				type: "document",
				label: "写分诊记录",
				select: "none",
				options: [],
				fields: ["主诉"],
				free_input: false,
				confirm: false,
			},
			{
				id: "pick_spot",
				type: "act",
				label: "安排位置",
				select: "single",
				options: ["留观区", "走廊加床"],
				fields: [],
				free_input: false,
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

async function enterSession(user: UserEvent, view: ScenarioView) {
	mocks.createScenarioSession.mockResolvedValue({
		session_id: view.session.id,
		pack: { key: PACK.key, title: PACK.title, revision_id: 9 },
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
	await screen.findByRole("button", { name: /直接分到红区/ });
}

beforeEach(() => {
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.listMyScenarioSessions.mockResolvedValue([]);
	mocks.postScenarioAction.mockResolvedValue({
		session_id: 21,
		problems: [],
		view: makeView(),
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("动作按钮：二次确认", () => {
	it("confirm=true 的动作先弹确认；确认后才提交", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		await user.click(screen.getByRole("button", { name: /直接分到红区/ }));

		expect(
			await screen.findByText("这个动作可能不可逆，确定要做吗？"),
		).toBeInTheDocument();
		expect(mocks.postScenarioAction).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "就做这件事" }));
		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(21, {
				affordance_id: "triage_red",
				type: "act",
			});
		});
	});

	it("在确认框里取消就不提交", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		await user.click(screen.getByRole("button", { name: /直接分到红区/ }));
		await screen.findByText("这个动作可能不可逆，确定要做吗？");
		await user.click(screen.getByRole("button", { name: "取消" }));

		expect(mocks.postScenarioAction).not.toHaveBeenCalled();
	});

	it("confirm=false 的动作一键即做，不打扰", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		await user.click(screen.getByRole("button", { name: /分到黄区观察/ }));

		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(21, {
				affordance_id: "triage_yellow",
				type: "act",
			});
		});
		expect(
			screen.queryByText("这个动作可能不可逆，确定要做吗？"),
		).not.toBeInTheDocument();
	});

	it("DM 建议按钮指向 confirm 动作时同样先确认（同一动作的两个入口不能一个有闸一个没闸）", async () => {
		const user = userEvent.setup();
		await enterSession(
			user,
			makeView({
				options: [
					{
						label: "立即送抢救区",
						type: "act",
						affordance_id: "triage_red",
						params: {},
						free_input: true,
					},
				],
			}),
		);

		await user.click(screen.getByRole("button", { name: /立即送抢救区/ }));
		expect(
			await screen.findByText("这个动作可能不可逆，确定要做吗？"),
		).toBeInTheDocument();
		expect(mocks.postScenarioAction).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "就做这件事" }));
		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(21, {
				affordance_id: "triage_red",
				type: "act",
				text: "立即送抢救区",
			});
		});
	});
});

describe("动作按钮：自输入入口", () => {
	it("free_input=false 的选择型动作不出现「其他（自己输入）」", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		await user.click(screen.getByRole("button", { name: /安排位置/ }));

		expect(await screen.findByRole("radio", { name: "留观区" })).toBeInTheDocument();
		expect(screen.queryByRole("radio", { name: OTHER_ENTRY_LABEL })).toBeNull();
		expect(
			screen.queryByLabelText("自己写（提交为自输入内容）"),
		).toBeNull();
	});

	it("free_input=false 的记录表单同样不出现自输入入口，字段照旧生成", async () => {
		const user = userEvent.setup();
		await enterSession(user, makeView());

		await user.click(screen.getByRole("button", { name: /写分诊记录/ }));

		expect(await screen.findByLabelText("主诉")).toBeInTheDocument();
		expect(
			screen.queryByRole("checkbox", { name: OTHER_ENTRY_LABEL }),
		).toBeNull();

		await user.type(screen.getByLabelText("主诉"), "胸痛 20 分钟");
		await user.click(screen.getByRole("button", { name: "就做这件事" }));
		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(21, {
				affordance_id: "write_note",
				type: "document",
				text: "主诉：胸痛 20 分钟",
				selected: [],
				custom_text: null,
			});
		});
	});
});
