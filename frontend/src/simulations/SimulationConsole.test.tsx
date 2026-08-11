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
		await userEvent.type(input, "/transfuse");
		await userEvent.keyboard("{Enter}");
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
		await userEvent.keyboard("{ArrowUp}");
		expect(input).toHaveValue("/transfuse");
		await userEvent.keyboard("{ArrowUp}");
		expect(input).toHaveValue("/status");
		await userEvent.keyboard("{ArrowDown}");
		expect(input).toHaveValue("/transfuse");
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
		await userEvent.type(input, "/assess ");
		const options = await screen.findAllByRole("button", { name: /\/assess (vitals|drain|pain|urine)/ });
		expect(options).toHaveLength(4);
		await userEvent.click(screen.getByRole("button", { name: /\/assess vitals/ }));
		expect(input).toHaveValue("/assess vitals");
		expect(mocks.post).not.toHaveBeenCalled(); // click only fills, does not run
	});
});
