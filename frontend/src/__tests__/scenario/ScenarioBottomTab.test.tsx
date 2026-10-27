import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import { NAV_ITEMS } from "@/components/shell/navigation";
import useAuthStore from "@/stores/authStore";
import { render } from "../render";

/**
 * 移动端底部 Tab：内容**由路由表派生**（`nav.mobile`），权限过滤在 Layout 里完成一次。
 *
 * 这里刻意走与生产同一条链路（NAV_ITEMS → 按权限过滤 → BottomTabBar），
 * 因为 2026-09-30 之前底栏自带一份硬编码清单与权限判断，导致"桌面有入口、手机没有"
 * 这类漏改无法被测试发现。
 *
 * 「情境」只在持有 `scenario_training` 时出现——否则手机上会多一个点了就 404 的死 Tab
 * （后端 kill switch 关掉时整段命名空间 404）。
 */
function renderTabs(pathname = "/training") {
	const permissions = useAuthStore.getState().permissions;
	const links = NAV_ITEMS.filter((l) => !l.permission || permissions.includes(l.permission));
	return render(
		<MemoryRouter initialEntries={[pathname]}>
			<BottomTabBar links={links} />
		</MemoryRouter>,
	);
}

describe("底部 Tab 的情境入口", () => {
	beforeEach(() => {
		useAuthStore.setState({ permissions: [] });
	});

	it("持有 scenario_training：出现「情境」Tab（其余四项照旧）", () => {
		// 底栏条目现在完全由路由表派生，所以「问答」这类条目也带自己的权限门
		// （旧实现里它恒显，权限不足时会给出一个点进去就 403 的死 Tab）
		useAuthStore.setState({ permissions: ["training_access", "scenario_training", "qa_access"] });
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
		useAuthStore.setState({ permissions: ["training_access", "scenario_training", "qa_access"] });
		renderTabs("/scenario");

		expect(screen.getByRole("button", { name: "情境" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("button", { name: "训练" })).not.toHaveAttribute("aria-current");
	});

	it("教师轨有自己的三项 + 「更多」：管理端放不下的条目靠它可达，学生轨不出现它", () => {
		useAuthStore.setState({ permissions: ["score_review", "assignment_manage", "stats_view"] });
		const links = NAV_ITEMS.filter(
			(l) => !l.permission || useAuthStore.getState().permissions.includes(l.permission),
		);
		render(
			<MemoryRouter initialEntries={["/admin"]}>
				<BottomTabBar links={links} onOpenNav={() => {}} />
			</MemoryRouter>,
		);

		for (const label of ["教学看板", "待批阅", "作业管理", "更多"]) {
			expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
		}
		// 学生轨条目不得混进教师底栏（两轨是两套日常，不是一套子集）
		expect(screen.queryByRole("button", { name: "训练" })).toBeNull();
	});
});
