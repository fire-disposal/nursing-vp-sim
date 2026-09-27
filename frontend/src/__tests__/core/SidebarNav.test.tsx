import {
	IconActivity,
	IconClipboardList,
	IconSitemap,
	IconStethoscope,
	IconUsers,
} from "@tabler/icons-react";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import SidebarNav from "@/components/shell/SidebarNav";
import { render } from "../render";

/**
 * 侧边栏分组：**教师端**把学生向条目收进"我的训练"分组，**学生端保持不变**（平铺）。
 * 背景：管理页很多，学生向条目混在管理分组上方平铺会让教师找不到自己的训练入口。
 * 另：「情境」走的就是这条既有链（`section: "user"` + `scenario_training`），
 * 所以分组里必须有它，且当前路由在分组内时分组要默认展开（否则教师看不到自己正打开的入口）。
 */
// NavItem 需要 icon（组件会渲染 <Icon/>）+ section
const USER_LINKS = [
	{ to: "/training", label: "训练", icon: IconStethoscope, section: "user" },
	{ to: "/scenario", label: "情境", icon: IconSitemap, section: "user" },
	{ to: "/history", label: "记录", icon: IconClipboardList, section: "user" },
] as never;

const ADMIN_LINKS = [
	{ to: "/admin/records", label: "训练记录", icon: IconClipboardList, section: "admin", group: "teaching" },
	{ to: "/admin/users", label: "用户管理", icon: IconUsers, section: "admin", group: "people" },
	{ to: "/admin/audit-logs", label: "审计日志", icon: IconActivity, section: "admin", group: "system" },
] as never;

function renderNav(groupUserLinks: boolean, pathname = "/") {
	return render(
		<MemoryRouter initialEntries={[pathname]}>
			<SidebarNav
				userLinks={USER_LINKS}
				adminLinks={ADMIN_LINKS}
				onNavigate={() => {}}
				groupUserLinks={groupUserLinks}
			/>
		</MemoryRouter>,
	);
}

describe("SidebarNav 分组", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("学生端：学生向条目平铺、不出现分组标题", () => {
		renderNav(false);
		expect(screen.queryByText("我的训练")).toBeNull();
		expect(screen.getByText("训练")).toBeDefined();
	});

	it("教师端：学生向条目收进「我的训练」分组", () => {
		renderNav(true);
		expect(screen.getByText("我的训练")).toBeDefined();
		// 管理分组照旧存在
		expect(screen.getByText("教学")).toBeDefined();
		expect(screen.getByText("人员")).toBeDefined();
		expect(screen.getByText("运维")).toBeDefined();
	});

	it("教师端：管理分组与学生分组互不串味", () => {
		renderNav(true);
		const personalGroup = screen.getByText("我的训练").closest("button, a, div");
		expect(personalGroup?.textContent ?? "").not.toContain("审计日志");
	});

	it("教师端：当前路由在分组内时分组默认展开，「情境」直接可见且指向 /scenario", () => {
		renderNav(true, "/scenario");
		const group = screen.getByText("我的训练").closest("a, button");
		expect(group?.getAttribute("data-expanded")).toBe("true");
		const link = screen.getByText("情境").closest("a");
		expect(link?.getAttribute("href")).toBe("/scenario");
		expect(link).toBeVisible();
	});

	it("教师端：当前路由不在分组内时分组保持收起（默认展开只由当前路由触发）", () => {
		renderNav(true, "/admin/users");
		const group = screen.getByText("我的训练").closest("a, button");
		expect(group?.getAttribute("data-expanded")).not.toBe("true");
		expect(screen.getByText("情境")).not.toBeVisible();
		expect(screen.getByText("训练")).not.toBeVisible();
	});

	it("学生端：平铺展示，「情境」照样在（不因分组逻辑丢失入口）", () => {
		renderNav(false, "/scenario");
		expect(screen.queryByText("我的训练")).toBeNull();
		expect(screen.getByText("情境").closest("a")?.getAttribute("href")).toBe("/scenario");
	});
});
