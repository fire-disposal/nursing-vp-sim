import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/__tests__/render";
import type { ScenarioView } from "@/api/scenario";
import { OTHER_ENTRY_LABEL } from "@/scenario/AffordanceForm";
import ScenarioConsole from "@/scenario/ScenarioConsole";

const mocks = vi.hoisted(() => ({
	listScenarioPacks: vi.fn(),
	createScenarioSession: vi.fn(),
	postScenarioAction: vi.fn(),
	closeScenarioSession: vi.fn(),
}));

// 只替换网络调用：`isScenarioUnavailable`（404 判定）走真实实现，
// 否则"关闭时整个命名空间 404"这一条就只是在测 mock。
vi.mock("@/api/scenario", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@/api/scenario");
	return {
		...actual,
		listScenarioPacks: mocks.listScenarioPacks,
		createScenarioSession: mocks.createScenarioSession,
		postScenarioAction: mocks.postScenarioAction,
		closeScenarioSession: mocks.closeScenarioSession,
	};
});

const PACK = {
	key: "sputum_ineffective",
	title: "术后低氧",
	state: "experimental",
	one_line: "术后第二天，患者呼吸费力。",
	revision_id: 7,
	revision_no: 3,
};

function makeView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return {
		session: { id: 12, status: "active", turn: 3, lost: false },
		pack: {
			key: "sputum_ineffective",
			title: "术后低氧",
			player_role: "责任护士",
			revision_id: 7,
		},
		situation: {
			place: "外科病房 3 床",
			time_hint: "术后第 2 天 08:40",
			resources: ["负压吸引器"],
			visible_cues: ["患者呼吸费力"],
			noticed: ["指脉氧 89%"],
		},
		actors: [
			{ id: "patient", role: "患者", presence: "on_site", present: true },
			{ id: "doctor", role: "值班医生", presence: "off_site", present: false },
		],
		hud: [
			{ slot: "血氧", source: "state", label: "血氧", value: 89, ref: "vitals.spo2" },
		],
		messages: [
			{ role: "scene", text: "监护仪在响。", turn: 1 },
			{
				role: "actor",
				actor: "patient",
				actor_role: "患者·张伯",
				ephemeral: false,
				avatar_seed: "patient",
				text: "我……喘不上气。",
				origin: "dm",
			},
			{
				role: "actor",
				actor: "patient",
				actor_role: "患者·张伯",
				ephemeral: false,
				avatar_seed: "patient",
				text: "（自己开口）我胸口闷。",
				origin: "entity",
			},
			{
				// DM 临时拉人开口：不入名册，只有显示名
				role: "actor",
				actor: null,
				actor_role: "走廊里的护工",
				ephemeral: true,
				avatar_seed: "走廊里的护工",
				text: "需要我去叫人吗？",
				origin: "dm",
			},
		],
		// DM 此刻给的提示：只有它能把表单带出来（pack 的 affordances 不上界面）
		options: [
			{
				label: "看看呼吸",
				type: "observe",
				affordance_id: "auscultate",
				params: {},
				free_input: true,
			},
			{ label: "换个姿势", type: "act", affordance_id: "position", params: {} },
			{ label: "安抚他", type: "act", affordance_id: "comfort", params: {} },
		],
		affordances: [
			{
				id: "auscultate",
				type: "observe",
				label: "听诊双肺",
				select: "none",
				options: [],
				fields: [],
				free_input: true,
				confirm: false,
			},
			{
				id: "position",
				type: "act",
				label: "摆体位",
				select: "single",
				options: ["左侧卧位", "半坐位"],
				fields: [],
				free_input: true,
				confirm: false,
			},
			{
				id: "comfort",
				type: "act",
				label: "安抚措施",
				select: "multi",
				options: ["盖被", "握手"],
				fields: [],
				free_input: true,
				confirm: false,
			},
			{
				id: "record",
				type: "document",
				label: "写护理记录",
				select: "none",
				options: [],
				fields: ["时间", "观察"],
				free_input: true,
				confirm: false,
			},
		],
		free_input: true,
		timeline: [
			{ turn: 1, kind: "student", label: "听诊双肺" },
			{ turn: 1, kind: "world", label: "痰鸣音明显", by: "patient" },
		],
		dims: [],
		nudges: ["先确认气道是否通畅。"],
		problems: [],
		...overrides,
	};
}

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/scenario"]}>
				<ScenarioConsole />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** 开场 → 起一次会话 → 停在主界面（`beforeEach` 已备好 packs/create 的返回）。 */
async function enterSession(user: UserEvent) {
	renderPage();
	await user.click(await screen.findByText("术后低氧"));
	// 动作区常驻：它就是"已经进场"的稳定标志（不再有 affordance 按钮可等）
	await screen.findByLabelText("动作区");
}

beforeEach(() => {
	mocks.listScenarioPacks.mockResolvedValue([PACK]);
	mocks.createScenarioSession.mockResolvedValue({
		session_id: 12,
		pack: { key: PACK.key, title: PACK.title, revision_id: 7 },
		view: makeView(),
	});
	mocks.postScenarioAction.mockResolvedValue({
		session_id: 12,
		problems: [],
		view: makeView(),
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("情境训练控制台", () => {
	it("动作区只有 DM 提示条 + 常驻输入条，pack 的 affordances 完全不上界面", async () => {
		const user = userEvent.setup();
		await enterSession(user);

		// 气泡流末尾的 DM 提示（点一下才知道该做什么）
		expect(screen.getByRole("button", { name: /看看呼吸/ })).toBeInTheDocument();
		// 常驻输入条与提示共存（不是二选一）
		expect(screen.getByLabelText("你要做什么")).toBeInTheDocument();
		// 理论上可做的事不上界面：没有「更多动作」，也没有 affordance 列表/分类/计数
		expect(screen.queryByRole("button", { name: /听诊双肺/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /摆体位/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /安抚措施/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /写护理记录/ })).toBeNull();
		expect(screen.queryByText(/更多动作/)).toBeNull();
		expect(document.querySelectorAll(".sc-option")).toHaveLength(3);
	});

	it("单选动作由 DM 提示带出表单：「其他」写的字进 custom_text，不进 selected", async () => {
		const user = userEvent.setup();
		await enterSession(user);

		await user.click(screen.getByRole("button", { name: /换个姿势/ }));
		await user.click(
			await screen.findByRole("radio", { name: OTHER_ENTRY_LABEL }),
		);
		await user.type(
			screen.getByLabelText("自己写"),
			"给患者垫高床头",
		);
		await user.click(screen.getByRole("button", { name: "就做这件事" }));

		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledTimes(1);
		});
		expect(mocks.postScenarioAction).toHaveBeenCalledWith(12, {
			affordance_id: "position",
			type: "act",
			text: null,
			selected: [],
			custom_text: "给患者垫高床头",
		});
	});

	it("多选动作勾选项进 selected，自输入另走 custom_text", async () => {
		const user = userEvent.setup();
		await enterSession(user);

		await user.click(screen.getByRole("button", { name: /安抚他/ }));
		await user.click(await screen.findByRole("checkbox", { name: "盖被" }));
		await user.click(
			await screen.findByRole("checkbox", { name: OTHER_ENTRY_LABEL }),
		);
		await user.type(
			screen.getByLabelText("自己写"),
			"把床头铃放到他手边",
		);
		await user.click(screen.getByRole("button", { name: "就做这件事" }));

		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(12, {
				affordance_id: "comfort",
				type: "act",
				text: null,
				selected: ["盖被"],
				custom_text: "把床头铃放到他手边",
			});
		});
	});

	it("document 表单同样由提示带出：「其他」的字段进 text，自输入进 custom_text", async () => {
		const user = userEvent.setup();
		// 记录型动作也只有 DM 提示能带出来：这一回合的提示挂在它上面
		mocks.createScenarioSession.mockResolvedValue({
			session_id: 12,
			pack: { key: PACK.key, title: PACK.title, revision_id: 7 },
			view: makeView({
				options: [
					{ label: "记一笔", type: "document", affordance_id: "record", params: {} },
				],
			}),
		});
		await enterSession(user);

		await user.click(screen.getByRole("button", { name: "记一笔" }));
		await user.type(await screen.findByLabelText("时间"), "08:50");
		await user.click(
			await screen.findByRole("checkbox", { name: OTHER_ENTRY_LABEL }),
		);
		await user.type(
			screen.getByLabelText("自己写"),
			"患者家属在门外",
		);
		await user.click(screen.getByRole("button", { name: "就做这件事" }));

		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(12, {
				affordance_id: "record",
				type: "document",
				text: "时间：08:50",
				selected: [],
				custom_text: "患者家属在门外",
			});
		});
	});

	it("自由通道以 type=ask 提交 text", async () => {
		const user = userEvent.setup();
		await enterSession(user);

		await user.type(screen.getByLabelText("你要做什么"), "现在最难受的是什么？");
		await user.click(screen.getByRole("button", { name: "发送" }));

		await waitFor(() => {
			expect(mocks.postScenarioAction).toHaveBeenCalledWith(12, {
				type: "ask",
				text: "现在最难受的是什么？",
			});
		});
	});

	it("临时角色用 actor_role 渲染、带 ephemeral 标记且不进在场者条", async () => {
		const user = userEvent.setup();
		await enterSession(user);

		// 身份标签用后端给的显示名（临时角色没有 actor id，不能显示 id）
		expect(screen.getByText("走廊里的护工")).toBeInTheDocument();
		// 平台口吻的"临时/某个声音"都不写：学生看到的就是世界里的话
		expect(screen.queryByText("临时")).toBeNull();
		expect(screen.queryByText("某个声音")).toBeNull();
		expect(screen.getByText("需要我去叫人吗？")).toBeInTheDocument();
		// 头像由前端从 avatar_seed 派生：首字 + 哈希取色（同一 seed → 同一颜色）
		const ephLine = screen
			.getByText("走廊里的护工")
			.closest(".sc-line") as HTMLElement | null;
		expect(ephLine?.dataset.ephemeral).toBe("true");
		expect(ephLine?.querySelector(".sc-avatar")?.textContent).toBe("走");
		expect(ephLine?.style.getPropertyValue("--sc-speaker")).toMatch(
			/^hsl\(\d+ \d+% \d+%\)$/,
		);
		// 名册角色同理：首字来自显示名（"患者·张伯" → 患），而不是 actor id "patient"
		const declaredLine = screen
			.getByText("我……喘不上气。")
			.closest(".sc-line") as HTMLElement | null;
		expect(declaredLine?.querySelector(".sc-avatar")?.textContent).toBe("患");
		expect(declaredLine?.dataset.ephemeral).toBe("false");

		// 在场者条只来自 view.actors：临时角色不得被塞进去
		const strip = document.querySelector(".sc-actors") as HTMLElement;
		expect(strip).not.toBeNull();
		expect(within(strip).queryByText("走廊里的护工")).not.toBeInTheDocument();
		expect(within(strip).getAllByRole("button")).toHaveLength(2);
		expect(within(strip).getByText("患者")).toBeInTheDocument();
	});

	it("view.panels 决定面板开关（未声明的收窄，dims 随情绪/覆盖面板走）", async () => {
		const user = userEvent.setup();
		const dims = [
			{ id: "d_actions", label: "处置动作数", agg: "count", value: 2, unit: "次", detail: "共 2 个动作" },
		];
		mocks.createScenarioSession.mockResolvedValue({
			session_id: 12,
			pack: { key: PACK.key, title: PACK.title, revision_id: 7 },
			view: makeView({ panels: ["coverage"], dims }),
		});
		await enterSession(user);

		// coverage → 现场降级为场景里的一行（就在画面里，不在侧栏）
		const situation = document.querySelector(".sc-situation");
		expect(situation).not.toBeNull();
		expect(situation?.textContent).toContain("负压吸引器");
		// timeline 未声明 + 没有线索 → 侧栏不渲染空壳
		expect(screen.queryByLabelText("经历面板")).toBeNull();
		// dims 是情绪/覆盖共用的量化投影：coverage 在 → 顶栏细进度仍展示
		const progress = screen.getByLabelText("经历量化");
		expect(within(progress).getByText(/处置动作数/)).toBeInTheDocument();
	});

	it("命名空间 404（功能关闭）显示「未开启」而不是报错", async () => {
		mocks.listScenarioPacks.mockRejectedValue({
			isAxiosError: true,
			message: "Request failed with status code 404",
			response: { status: 404 },
		});

		renderPage();

		expect(
			await screen.findByText("情境训练当前未开启"),
		).toBeInTheDocument();
		expect(screen.queryByText("情境列表读取失败")).not.toBeInTheDocument();
	});
});
