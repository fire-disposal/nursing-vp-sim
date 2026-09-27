import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/__tests__/render";
import Login from "@/pages/Login";

const loginMock = vi.fn();

vi.mock("@/pages/LoginIllustration", () => ({
	default: () => null,
}));

vi.mock("@/stores/authStore", () => ({
	default: (selector: (s: unknown) => unknown) =>
		selector({ login: loginMock, user: null, token: null }),
}));

function renderLogin() {
	return render(
		<MemoryRouter>
			<Login />
		</MemoryRouter>,
	);
}

describe("Login submit state", () => {
	it("shows loading label while submitting", async () => {
		let resolveLogin: () => void = () => {};
		loginMock.mockImplementation(
			() => new Promise<void>((res) => { resolveLogin = res; }),
		);
		const user = userEvent.setup();
		renderLogin();

		await user.type(screen.getByPlaceholderText("用户名"), "alice");
		await user.type(screen.getByPlaceholderText("密码"), "secret123");
		await user.click(screen.getByRole("button", { name: "登 录" }));

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "登录中..." })).toBeDisabled(),
		);
		resolveLogin();
	});
});

describe("Login 入口：临床推理模拟已下线（docs/18，2026-09-28）", () => {
	it("不再渲染该入口，且保留忘记密码提示", () => {
		renderLogin();
		expect(screen.queryByText("临床推理模拟实验（免登录体验）")).toBeNull();
		expect(screen.queryByText("体验入口")).toBeNull();
		expect(screen.getByText("忘记密码？请联系教师或管理员重置")).toBeDefined();
	});
});
