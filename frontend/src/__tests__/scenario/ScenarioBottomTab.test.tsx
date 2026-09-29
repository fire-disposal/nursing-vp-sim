import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import useAuthStore from "@/stores/authStore";
import { render } from "../render";

/**
 * 移动端底部 Tab 的「情境」入口：基础四项对所有人恒在，「情境」只在持有 `scenario_training`
 * 时出现——否则学生手机上会多一个点了就 404 的死 Tab（后端 kill switch 关掉时整段命名空间 404）。
 */
function renderTabs(pathname = "/training") {
	return render(
		<MemoryRouter initialEntries={[pathname]}>
			<BottomTabBar />
		</MemoryRouter>,
	);
}

describe("底部 Tab 的情境入口", () => {
	beforeEach(() => {
		useAuthStore.setState({ permissions: [] });
	});

	it("持有 scenario_training：出现「情境」Tab（其余四项照旧）", () => {
		useAuthStore.setState({ permissions: ["training_access", "scenario_training"] });
		renderTabs();

		for (const label of ["训练", "情境", "记录", "问答", "我的"]) {
			expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
		}
	});

	it("没有该权限键：不出现「情境」Tab（其余四项照旧）", () => {
		useAuthStore.setState({ permissions: ["training_access", "qa_access"] });
		renderTabs();

		expect(screen.queryByRole("button", { name: "情境" })).toBeNull();
		for (const label of ["训练", "记录", "问答", "我的"]) {
			expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
		}
	});

	it("当前就在情境页：该 Tab 标为当前项（学生看得出自己在哪）", () => {
		useAuthStore.setState({ permissions: ["scenario_training"] });
		renderTabs("/scenario");

		expect(screen.getByRole("button", { name: "情境" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("button", { name: "训练" })).not.toHaveAttribute("aria-current");
	});
});
