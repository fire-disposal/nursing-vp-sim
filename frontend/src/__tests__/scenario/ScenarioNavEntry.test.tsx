import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/shell/navigation";
import SidebarNav from "@/components/shell/SidebarNav";
import { render } from "../render";

/**
 * 情境训练的可见入口（2026-09-27 转正式特性）。
 *
 * 断言的机制就是既有那一条：`Layout.tsx` 用 `NAV_ITEMS` 按用户权限键过滤，再按 `section`
 * 分给学生侧栏/底部 Tab 与管理侧栏 —— 不另造闸门，只验证「情境」/「情境管理」挂在这条链上。
 */
const visible = (permissions: string[], section: "user" | "admin") =>
	NAV_ITEMS.filter((item) => !item.permission || permissions.includes(item.permission)).filter(
		(item) => item.section === section,
	);

const STUDENT_PERMISSIONS = ["training_access", "scenario_training", "qa_access"];

function renderSidebar(permissions: string[], pathname = "/") {
	return render(
		<MemoryRouter initialEntries={[pathname]}>
			<SidebarNav
				userLinks={visible(permissions, "user")}
				adminLinks={visible(permissions, "admin")}
				onNavigate={() => {}}
			/>
		</MemoryRouter>,
	);
}

describe("学生侧「情境」入口", () => {
	it("持有 scenario_training 的学生在侧栏看到「情境」，指向 /scenario", () => {
		renderSidebar(STUDENT_PERMISSIONS);
		const link = screen.getByText("情境").closest("a");
		expect(link?.getAttribute("href")).toBe("/scenario");
	});

	it("没有 scenario_training 的学生看不到「情境」（训练/问答照旧）", () => {
		renderSidebar(["training_access", "qa_access"]);
		expect(screen.queryByText("情境")).toBeNull();
		expect(screen.getByText("训练")).toBeDefined();
		expect(screen.getByText("问答")).toBeDefined();
	});
});

describe("管理侧「情境管理」入口", () => {
	it("有 case_manage 的管理员看到「情境管理」，指向 /scenario-admin", () => {
		renderSidebar(["case_manage", "stats_view"], "/scenario-admin");
		const link = screen.getByText("情境管理").closest("a");
		expect(link?.getAttribute("href")).toBe("/scenario-admin");
	});

	it("没有 case_manage（只有 stats_view）的管理员看不到「情境管理」", () => {
		renderSidebar(["stats_view"]);
		expect(screen.queryByText("情境管理")).toBeNull();
	});

	it("学生看不到管理侧入口", () => {
		renderSidebar(STUDENT_PERMISSIONS);
		expect(screen.queryByText("情境管理")).toBeNull();
	});
});
