import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SimulationConsole from "./SimulationConsole";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
}));

vi.mock("@/api/simulations", () => ({
	createSimulationSession: mocks.create,
	getSimulationSession: mocks.get,
	postSimulationAction: mocks.post,
}));

const baseSnapshot = {
	session_id: 1,
	revision: 0,
	case_status: "ACTIVE",
	case_meta: { id: "mvpb-1", name: "腹部术后隐匿性出血（MVP-B）", version: "mvpb-1" },
	current_time: 0,
	clock: "08:30",
	monitoring: false,
	reported: false,
	messages: [{ kind: "SYSTEM", at_minute: 0, text: "病例已开始。" }],
	vitals: [],
	drain: [],
	pain: [],
	urine: [],
	pending: [],
	lab_records: [],
	unrevealed_lab_count: 0,
	cbc_count: 0,
	diag_spent: 0,
	diag_budget: 400,
	treat_spent: 0,
	treat_budget: 100,
	case_ended_at: null,
};

describe("SimulationConsole", () => {
	beforeEach(() => {
		mocks.create.mockReset();
		mocks.get.mockReset();
		mocks.post.mockReset();
		localStorage.clear();
		mocks.create.mockResolvedValue({ session_id: 1, snapshot: baseSnapshot });
	});

	it("creates a session on mount and renders the clock, status and messages", async () => {
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());
		const header = document.querySelector(".sim-header") as HTMLElement;
		expect(within(header).getByText("08:30")).toBeInTheDocument();
		expect(screen.getByText("ACTIVE")).toBeInTheDocument();
		expect(screen.getByText("病例已开始。")).toBeInTheDocument();
		expect(screen.getByText("[SYSTEM]")).toBeInTheDocument();
	});

	it("restores the stored session on reload instead of creating a new one", async () => {
		localStorage.setItem("simulation.sessionId", "42");
		mocks.get.mockResolvedValue({
			...baseSnapshot,
			session_id: 42,
			messages: [
				{ kind: "ASSESSMENT", at_minute: 2, text: "生命体征（08:32）：HR 84 bpm。未见明显异常。" },
			],
		});
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(42));
		expect(mocks.create).not.toHaveBeenCalled();
		expect(screen.getByText(/生命体征/)).toBeInTheDocument();
	});

	it("submits a structured action and echoes the typed command", async () => {
		mocks.post.mockResolvedValue({
			session_id: 1,
			revision: 1,
			accepted: true,
			case_ended: false,
			messages: [
				{ kind: "ASSESSMENT", at_minute: 2, text: "生命体征（08:32）：HR 84 bpm，BP 117/78 mmHg。未见明显异常。" },
			],
			snapshot: {
				...baseSnapshot,
				revision: 1,
				current_time: 2,
				clock: "08:32",
			},
		});
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		const input = await screen.findByPlaceholderText(/输入命令/);
		await userEvent.type(input, "/assess vitals");
		await userEvent.keyboard("{Enter}");
		await waitFor(() => expect(mocks.post).toHaveBeenCalled());
		expect(mocks.post).toHaveBeenCalledWith(1, { type: "ASSESS", target: "vitals" });
		await waitFor(() => expect(screen.getByText("/assess vitals")).toBeInTheDocument());
		expect(screen.getByText("[INPUT]")).toBeInTheDocument();
		await waitFor(() => expect(screen.getByText(/生命体征/)).toBeInTheDocument());
	});

	it("walks command history with arrow keys", async () => {
		mocks.post.mockResolvedValue({
			session_id: 1,
			revision: 1,
			accepted: true,
			case_ended: false,
			messages: [],
			snapshot: baseSnapshot,
		});
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		const input = await screen.findByPlaceholderText(/输入命令/);
		await userEvent.type(input, "/status");
		await userEvent.keyboard("{Enter}");
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
		await userEvent.type(input, "/give morphine 10");
		await userEvent.keyboard("{Enter}");
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
		await userEvent.keyboard("{ArrowUp}");
		expect(input).toHaveValue("/give morphine 10");
		await userEvent.keyboard("{ArrowUp}");
		expect(input).toHaveValue("/status");
		await userEvent.keyboard("{ArrowDown}");
		expect(input).toHaveValue("/give morphine 10");
	});

	it("surfaces parser errors without calling the API", async () => {
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		const input = await screen.findByPlaceholderText(/输入命令/);
		await userEvent.type(input, "/xyz");
		await userEvent.keyboard("{Enter}");
		expect(mocks.post).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.getByText(/未知命令/)).toBeInTheDocument());
	});

	it("auto-expands the completion panel and fills input on click", async () => {
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		const input = await screen.findByPlaceholderText(/输入命令/);
		await userEvent.type(input, "/评估 ");
		const options = await screen.findAllByRole("button", { name: /\/评估 (生命体征|引流|疼痛|尿量|血糖|肺部听诊|意识)/ });
		expect(options).toHaveLength(7);
		await userEvent.click(screen.getByRole("button", { name: /\/评估 生命体征/ }));
		expect(input).toHaveValue("/评估 生命体征");
		expect(mocks.post).not.toHaveBeenCalled(); // click only fills, does not run
	});

	it("records and submits a diagnosis from the panel", async () => {
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());

		// 展开诊断面板并输入诊断
		await userEvent.click(screen.getByRole("button", { name: /诊断记录/ }));
		const textarea = await screen.findByPlaceholderText(/写下你的诊断判断/);
		await userEvent.type(textarea, "疑诊糖尿病酮症酸中毒");

		mocks.post.mockResolvedValue({
			session_id: 1,
			revision: 1,
			accepted: true,
			case_ended: false,
			messages: [{ kind: "SYSTEM", at_minute: 0, text: "已记录你的诊断。" }],
			snapshot: { ...baseSnapshot, revision: 1, diagnosis: "疑诊糖尿病酮症酸中毒" },
		});
		await userEvent.click(screen.getByRole("button", { name: /保存诊断/ }));

		await waitFor(() =>
			expect(mocks.post).toHaveBeenCalledWith(1, {
				type: "DIAG",
				target: "疑诊糖尿病酮症酸中毒",
			}),
		);
	});

	it("renders the server-driven action panel and executes buttons", async () => {
		const panelActions = {
			assess: [{ id: "vitals", label: "生命体征", duration: 2, enabled: true }],
			order: [{ id: "CBC", label: "血常规(CBC)", cost: 35, cost_label: "35检查点", turnaround: 15, enabled: true }],
			give: [{ id: "FLUIDS", label: "快速补液", cost: 30, cost_label: "30治疗点", unit: "ml", default_dose: 500, max_dose: 1500, enabled: true }],
			talk: [{ id: "patient", label: "患者", enabled: true }],
			manage: [{ id: "hint", label: "教练提示", enabled: true }],
		};
		mocks.post.mockResolvedValue({
			session_id: 1,
			revision: 1,
			accepted: true,
			case_ended: false,
			messages: [{ kind: "ASSESSMENT", at_minute: 2, text: "生命体征（08:32）：HR 84 bpm。未见明显异常。" }],
			snapshot: { ...baseSnapshot, revision: 1, current_time: 2, clock: "08:32", actions: panelActions },
		});
		mocks.create.mockResolvedValue({ session_id: 1, snapshot: { ...baseSnapshot, actions: panelActions } });
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());
		// 评估按钮点击 → 结构化动作
		await userEvent.click(await screen.findByRole("button", { name: /生命体征/ }));
		await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(1, { type: "ASSESS", target: "vitals" }));
		// 检查按钮点击
		await userEvent.click(screen.getByRole("button", { name: /血常规/ }));
		await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(1, { type: "ORDER", target: "CBC" }));
	});

	it("renders the brief card and the coach hint bar", async () => {
		const withGuidance = {
			...baseSnapshot,
			brief: {
				patient: "王秀兰，58 岁女性，昨日胃癌根治术后",
				task: "识别并有效报告隐匿性出血",
				goal: "评估→检查→报告",
				resources: { diag: 400, treat: 100, consult: 120 },
				assessments: ["vitals"],
				drugs: ["FLUIDS"],
				labs: ["CBC"],
				talk_roles: ["patient", "family"],
				opening_hint: "先评估建立基线：/assess vitals（2min）看生命体征。",
			},
			objectives: { assessed: false, evidence: false, monitoring: false, treated: false, reported: false, diagnosis: false, timely: null },
			hint: { level: 1, text: "先评估建立基线：/assess vitals（2min）看生命体征。" },
			patient: { consciousness: "alert", consciousness_label: "清醒", monitoring: false, latest_vitals: null },
			actions: { assess: [], order: [], give: [], talk: [], manage: [] },
		};
		mocks.create.mockResolvedValue({ session_id: 1, snapshot: withGuidance });
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());
		// 开局简报卡
		expect(screen.getByText("开局简报")).toBeInTheDocument();
		expect(screen.getByText(/王秀兰，58 岁女性/)).toBeInTheDocument();
		// 床旁状态卡
		expect(screen.getByText("床旁状态")).toBeInTheDocument();
		expect(screen.getByText("清醒")).toBeInTheDocument();
		// 教练提示条 + 目标清单
		expect(screen.getByText(/教练 L1/)).toBeInTheDocument();
		expect(screen.getByText(/异常证据/)).toBeInTheDocument();
		// 关闭提示条
		await userEvent.click(screen.getByRole("button", { name: "知道了" }));
		expect(screen.queryByText(/教练 L1/)).not.toBeInTheDocument();
	});

	it("renders latest vitals on the bedside panel", async () => {
		const withVitals = {
			...baseSnapshot,
			patient: {
				consciousness: "alert",
				consciousness_label: "清醒",
				monitoring: true,
				latest_vitals: { minute: 2, hr: 101, sbp: 108, dbp: 70, rr: 20, spo2: 96, temp: 37.0, abnormal: true },
			},
		};
		mocks.create.mockResolvedValue({ session_id: 1, snapshot: withVitals });
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());
		expect(screen.getByText("101")).toBeInTheDocument();
		expect(screen.getByText("HR 次/分")).toBeInTheDocument();
		expect(screen.getByText("108/70")).toBeInTheDocument();
	});

	it("renders the shift timeline with pending labs and waits on click", async () => {
		const withPending = {
			...baseSnapshot,
			pending: [
				{ id: "cbc-1", kind: "CBC", label: "血常规(CBC)", sampled_at: 3, due_at: 18, due_clock: "08:48" },
			],
		};
		mocks.create.mockResolvedValue({ session_id: 1, snapshot: withPending });
		mocks.post.mockResolvedValue({
			session_id: 1,
			revision: 1,
			accepted: true,
			case_ended: false,
			messages: [],
			snapshot: { ...withPending, revision: 1 },
		});
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());
		// 图例包含「待返回检查」，chips 行给出可等待入口
		expect(screen.getByText(/待返回检查/)).toBeInTheDocument();
		const chip = await screen.findByRole("button", { name: /等待/ });
		await userEvent.click(chip);
		await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(1, { type: "WAIT", target: "CBC" }));
	});

	it("renders teaching points on the end banner", async () => {
		const ended = {
			...baseSnapshot,
			case_status: "SUCCESS",
			teaching_points: "隐匿性出血的线索：心率↑/血压↓、引流增多、Hb 持续下降；早期开启监护并复查 CBC。",
			objectives: {
				assessed: true,
				evidence: true,
				monitoring: true,
				treated: false,
				reported: true,
				diagnosis: true,
				timely: "timely",
			},
		};
		mocks.create.mockResolvedValue({ session_id: 1, snapshot: ended });
		render(<MemoryRouter><SimulationConsole /></MemoryRouter>);
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());
		expect(screen.getByText(/教学要点/)).toBeInTheDocument();
		expect(screen.getByText(/隐匿性出血的线索/)).toBeInTheDocument();
		expect(screen.getByText(/✓ 及时/)).toBeInTheDocument();
	});
});
