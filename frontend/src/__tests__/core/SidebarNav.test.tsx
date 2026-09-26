import { screen } from "@testing-library/react";
import { IconActivity, IconClipboardList, IconStethoscope, IconUsers } from "@tabler/icons-react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SidebarNav from "@/components/shell/SidebarNav";
import { render } from "../render";

/**
 * 侧边栏分组：**教师端**把学生向条目收进"我的训练"分组，**学生端保持不变**（平铺）。
 * 背景：管理页很多，学生向条目混在管理分组上方平铺会让教师找不到自己的训练入口。
 */
// NavItem 需要 icon（组件会渲染 <Icon/>）+ section
const USER_LINKS = [
	{ to: "/training", label: "训练", icon: IconStethoscope, section: "user" },
	{ to: "/history", label: "记录", icon: IconClipboardList, section: "user" },
] as never;

const ADMIN_LINKS = [
	{ to: "/admin/records", label: "训练记录", icon: IconClipboardList, section: "admin", group: "teaching" },
	{ to: "/admin/users", label: "用户管理", icon: IconUsers, section: "admin", group: "people" },
	{ to: "/admin/audit-logs", label: "审计日志", icon: IconActivity, section: "admin", group: "system" },
] as never;

function renderNav(groupUserLinks: boolean) {
	return render(
		<MemoryRouter>
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
});
