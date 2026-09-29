import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/shell/navigation";
import SidebarNav from "@/components/shell/SidebarNav";
import { render } from "../render";

/**
 * 情境训练的可见入口（2026-09-27 转正式特性）。
 *
 * 断言的机制就是既有那一条：导航条目由 `NAV_ITEMS` 的条目级权限键过滤，再按 `section`
 * 分给学生侧栏/管理侧栏。这里先钉**条目自己的契约**（路径 / 名称 / 权限键），再渲染侧栏
 * 证明它挂在这条链上——不另造闸门。
 */
const SCENARIO_ENTRY = NAV_ITEMS.find((item) => item.to === "/scenario");
const SCENARIO_ADMIN_ENTRY = NAV_ITEMS.find((item) => item.to === "/scenario-admin");

const STUDENT_PERMISSIONS = ["training_access", "scenario_training", "qa_access"];

function renderSidebar(permissions: string[], pathname = "/") {
	const shown = NAV_ITEMS.filter(
		(item) => !item.permission || permissions.includes(item.permission),
	);
	return render(
		<MemoryRouter initialEntries={[pathname]}>
			<SidebarNav
				userLinks={shown.filter((item) => item.section === "user")}
				adminLinks={shown.filter((item) => item.section === "admin")}
				onNavigate={() => {}}
			/>
		</MemoryRouter>,
	);
}

describe("导航条目：情境训练", () => {
	it("学生侧条目：/scenario，名「情境」，条目级权限键是 scenario_training", () => {
		expect(SCENARIO_ENTRY).toBeDefined();
		expect(SCENARIO_ENTRY?.label).toBe("情境");
		expect(SCENARIO_ENTRY?.section).toBe("user");
		expect(SCENARIO_ENTRY?.permission).toBe("scenario_training");
	});

	it("管理侧条目：/scenario-admin，名「情境管理」，条目级权限键是 case_manage", () => {
		expect(SCENARIO_ADMIN_ENTRY).toBeDefined();
		expect(SCENARIO_ADMIN_ENTRY?.label).toBe("情境管理");
		expect(SCENARIO_ADMIN_ENTRY?.section).toBe("admin");
		// 该页需要两个权限键，路由级不判权限：门必须挂在条目上
		expect(SCENARIO_ADMIN_ENTRY?.permission).toBe("case_manage");
	});
});

describe("学生侧「情境」入口", () => {
	it("持有 scenario_training 的学生在侧栏看到「情境」，指向 /scenario", () => {
		renderSidebar(STUDENT_PERMISSIONS);

		expect(screen.getByRole("link", { name: "情境" })).toHaveAttribute("href", "/scenario");
	});

	it("当前就在情境页时标为当前项（活动态在链上可读）", () => {
		renderSidebar(STUDENT_PERMISSIONS, "/scenario");

		expect(screen.getByRole("link", { name: "情境" })).toHaveAttribute("data-active", "true");
		expect(screen.getByRole("link", { name: "训练" })).not.toHaveAttribute("data-active");
	});

	it("没有 scenario_training 的学生看不到「情境」（训练/问答照旧）", () => {
		renderSidebar(["training_access", "qa_access"]);

		expect(screen.queryByRole("link", { name: "情境" })).toBeNull();
		expect(screen.getByRole("link", { name: "训练" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "问答" })).toBeInTheDocument();
	});
});

describe("管理侧「情境管理」入口", () => {
	it("有 case_manage 的管理员看到「情境管理」，指向 /scenario-admin", () => {
		renderSidebar(["case_manage", "stats_view"], "/scenario-admin");

		expect(screen.getByRole("link", { name: "情境管理" })).toHaveAttribute(
			"href",
			"/scenario-admin",
		);
	});

	it("只有 stats_view 的管理员看不到「情境管理」（该页的另一半权限不替他开这个门）", () => {
		renderSidebar(["stats_view"]);

		expect(screen.queryByRole("link", { name: "情境管理" })).toBeNull();
	});

	it("学生看不到管理侧入口", () => {
		renderSidebar(STUDENT_PERMISSIONS);

		expect(screen.queryByRole("link", { name: "情境管理" })).toBeNull();
	});
});
