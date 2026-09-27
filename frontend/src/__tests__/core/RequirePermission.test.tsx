import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import RequirePermission from "@/components/RequirePermission";
import useAuthStore from "@/stores/authStore";
import { render } from "../render";

/**
 * 路由门禁：缺权限时**渲染 403 页**，不再静默重定向（`ui-improvement-plan` §F5 / UI-NAV-5）。
 * 旧行为是 `<Navigate to="/home">` —— 用户只看到"页面自己跳走了"，不知道缺什么权限、该找谁。
 */
function renderGate(permission: "user_manage" | "stats_view") {
	return render(
		<MemoryRouter initialEntries={["/training"]}>
			<RequirePermission permission={permission}>
				<div>受保护内容</div>
			</RequirePermission>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	useAuthStore.setState({ permissions: [], user: null, token: null });
});

describe("RequirePermission", () => {
	it("无权限时渲染 403 页：说明缺哪项权限 + 给出可行动路径，且不渲染受保护内容", () => {
		useAuthStore.setState({ permissions: ["training_access"] });

		renderGate("user_manage");

		expect(screen.getByText("没有访问权限")).toBeTruthy();
		// 权限键要翻成中文名，用户才知道该要什么
		expect(screen.getByText(/这个页面需要「用户管理」权限/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "回到我的训练" })).toBeTruthy();
		expect(screen.queryByText("受保护内容")).toBeNull();
	});

	it("有权限时照常渲染子内容，不出现 403 文案", () => {
		useAuthStore.setState({ permissions: ["stats_view"] });

		renderGate("stats_view");

		expect(screen.getByText("受保护内容")).toBeTruthy();
		expect(screen.queryByText("没有访问权限")).toBeNull();
	});
});
