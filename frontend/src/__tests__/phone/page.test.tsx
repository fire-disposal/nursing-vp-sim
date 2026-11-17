import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { render } from "@/__tests__/render";
import { APP_ROUTES, NAV_ITEMS, filterNavByPersona } from "@/components/shell/navigation";
import { PHONE_CHARACTERS } from "@/engine/phone/characters";
import Phone from "@/pages/practice/phone/Phone";

/**
 * 页面与入口：电话页必须是一个**独立演示**入口（学生视角、普通应用壳、
 * 不需要训练记录），并且四张角色卡能一屏区分开。
 */
describe("学生电话入口", () => {
	const phoneRoute = APP_ROUTES.find((r) => r.path === "/phone");

	it("路由存在：学生视角可见、普通应用壳、无隐藏", () => {
		expect(phoneRoute).toBeDefined();
		expect(phoneRoute?.activity).toBe("manage");
		expect(phoneRoute?.nav?.label).toBe("电话");
		expect(phoneRoute?.nav?.section).toBe("user");
		expect(phoneRoute?.nav?.group).toBe("personal");
		expect(phoneRoute?.permission).toBe("training_access");
		expect(phoneRoute?.nav?.mobile).toEqual({ order: 35, tier: "student" });
		expect(phoneRoute?.nav?.hideInSidebar).toBeFalsy();
	});

	it("侧栏可见（不是 hideInSidebar），且学生对这一档可见", () => {
		const item = NAV_ITEMS.find((i) => i.to === "/phone");
		expect(item).toBeDefined();
		expect(filterNavByPersona(NAV_ITEMS, "student").some((i) => i.to === "/phone")).toBe(true);
	});

	it("学生底部 Tab 与既有 Tab 不撞顺序", () => {
		const studentTabs = NAV_ITEMS.filter((i) => i.mobile?.tier === "student").map((i) => i.mobile!.order);
		expect(studentTabs).toContain(35);
		expect(new Set(studentTabs).size).toBe(studentTabs.length);
	});
});

describe("电话页角色卡", () => {
	it("渲染四张可区分的角色卡，且没有任何训练/评分语义", () => {
		const { container } = render(
			<MemoryRouter initialEntries={["/phone"]}>
				<Phone />
			</MemoryRouter>,
		);
		expect(screen.getByTestId("character-grid")).toBeInTheDocument();
		for (const character of PHONE_CHARACTERS) {
			expect(screen.getByTestId(`character-card-${character.id}`)).toBeInTheDocument();
			expect(screen.getByRole("button", { name: `呼叫 ${character.name}` })).toBeInTheDocument();
		}
		const text = container.textContent ?? "";
		expect(text).not.toMatch(/训练记录|得分|评分|难度/);
	});

	it("点角色卡进入电话界面，URL 记录所选角色", () => {
		const { container } = render(
			<MemoryRouter initialEntries={["/phone"]}>
				<Phone />
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole("button", { name: "呼叫 苏小满" }));
		expect(container.querySelector('[data-testid="phone-panel"]')).toBeTruthy();
		expect(screen.getAllByText("苏小满").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "开始通话" })).toBeInTheDocument();
	});

	it("?c= 深链直接进电话界面", () => {
		const { container } = render(
			<MemoryRouter initialEntries={["/phone?c=he-jianfeng"]}>
				<Phone />
			</MemoryRouter>,
		);
		expect(container.querySelector('[data-testid="phone-panel"]')).toBeTruthy();
		expect(screen.getByTestId("emotion-label")).toHaveTextContent("防御抵触");
	});
});
