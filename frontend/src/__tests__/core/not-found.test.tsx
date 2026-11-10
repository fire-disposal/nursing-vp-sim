import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "../render";
import NotFound from "@/pages/share/NotFound";
import useAuthStore from "@/stores/authStore";

function renderNotFound() {
	return render(
		<MemoryRouter initialEntries={["/missing"]}>
			<Routes>
				<Route path="/missing" element={<NotFound />} />
				<Route path="/login" element={<div>登录页</div>} />
				<Route path="/home" element={<div>可用首页</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("404 页面", () => {
	beforeEach(() => {
		useAuthStore.setState({ user: null, token: null });
	});

	it("未登录用户回到登录页", () => {
		renderNotFound();
		expect(screen.getByText("页面不存在")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
		expect(screen.getByText("登录页")).toBeInTheDocument();
	});

	it("已登录用户回到角色分派首页", () => {
		useAuthStore.setState({ token: "token", user: { id: 1 } as never });
		renderNotFound();
		fireEvent.click(screen.getByRole("button", { name: "回到首页" }));
		expect(screen.getByText("可用首页")).toBeInTheDocument();
	});
});
