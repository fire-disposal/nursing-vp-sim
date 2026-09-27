import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import useAuthStore from "@/stores/authStore";
import { render } from "../render";

/**
 * 移动端底部 Tab「情境」（2026-09-27 转正式特性）：基础四项对所有人恒在，
 * 「情境」只在持有 `scenario_training` 时出现 —— 否则学生手机上会多一个点了 403 的死 Tab。
 */
function renderTabs() {
	return render(
		<MemoryRouter>
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

		expect(screen.getByText("情境")).toBeDefined();
		expect(screen.getByText("训练")).toBeDefined();
	});

	it("没有该权限键：不出现「情境」Tab（其余四项照旧）", () => {
		useAuthStore.setState({ permissions: ["training_access", "qa_access"] });
		renderTabs();

		expect(screen.queryByText("情境")).toBeNull();
		for (const label of ["训练", "记录", "问答", "我的"]) {
			expect(screen.getByText(label)).toBeDefined();
		}
	});
});
