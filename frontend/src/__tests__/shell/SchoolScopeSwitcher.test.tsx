import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolScopeSwitcher } from "@/components/shell/SchoolScopeSwitcher";
import useAuthStore from "@/stores/authStore";
import { useSchoolScopeStore } from "@/stores/schoolScopeStore";

const mocks = vi.hoisted(() => ({ getSchools: vi.fn() }));

vi.mock("@/api/admin/schools", () => ({
	getSchools: mocks.getSchools,
	createSchool: vi.fn(),
	updateSchool: vi.fn(),
	deleteSchool: vi.fn(),
	uploadSchoolLogo: vi.fn(),
	deleteSchoolLogo: vi.fn(),
}));

const SCHOOLS = [
	{ id: 7, name: "杭州师范大学", theme_color: "indigo", has_logo: false, logo_updated_at: null },
	{ id: 8, name: "另一院校", theme_color: null, has_logo: false, logo_updated_at: null },
];

/** 把当前 search 打印出来，验证"切换院校会清掉与院校/班级相关的旧筛选"。 */
function SearchProbe() {
	const location = useLocation();
	return <div data-testid="search">{location.search}</div>;
}

function renderSwitcher(initialEntry = "/admin/records") {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[initialEntry]}>
				<SchoolScopeSwitcher />
				<SearchProbe />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSchools.mockResolvedValue({ data: SCHOOLS });
});

afterEach(() => {
	useAuthStore.setState({ permissions: [] });
	useSchoolScopeStore.getState().setSchool(null);
});

describe("当前院校切换器", () => {
	it("只对平台角色渲染", async () => {
		useAuthStore.setState({ permissions: [] });
		renderSwitcher();
		expect(screen.queryByRole("combobox", { name: "当前院校" })).toBeNull();
	});

	it("选中院校即写入作用域快照（主题色/院徽随快照走）", async () => {
		useAuthStore.setState({ permissions: ["school_manage"] });
		renderSwitcher();

		const combo = await screen.findByRole("combobox", { name: "当前院校" });
		await userEvent.click(combo);
		const listbox = document.getElementById(combo.getAttribute("aria-controls") ?? "");
		await userEvent.click(
			within(listbox as HTMLElement).getByRole("option", { name: "杭州师范大学", hidden: true }),
		);

		await waitFor(() =>
			expect(useSchoolScopeStore.getState().school).toEqual({
				id: 7,
				name: "杭州师范大学",
				themeColor: "indigo",
				hasLogo: false,
				logoUpdatedAt: null,
			}),
		);
	});

	it("切换院校会清掉作用域外的旧筛选（class_id / school_id），避免切完就 404", async () => {
		useAuthStore.setState({ permissions: ["school_manage"] });
		renderSwitcher("/admin/records?class_id=3&school_id=9&review_status=pending");

		const combo = await screen.findByRole("combobox", { name: "当前院校" });
		await userEvent.click(combo);
		const listbox = document.getElementById(combo.getAttribute("aria-controls") ?? "");
		await userEvent.click(
			within(listbox as HTMLElement).getByRole("option", { name: "杭州师范大学", hidden: true }),
		);

		await waitFor(() => {
			const search = screen.getByTestId("search").textContent ?? "";
			expect(search).not.toContain("class_id");
			expect(search).not.toContain("school_id");
			// 与院校无关的筛选（如待批阅）保留
			expect(search).toContain("review_status=pending");
		});
	});

	it("院校被删除后作用域退回全部院校，而不是指向不存在的院校", async () => {
		useAuthStore.setState({ permissions: ["school_manage"] });
		useSchoolScopeStore.getState().setSchool({
			id: 99,
			name: "已删除院校",
			themeColor: null,
			hasLogo: false,
			logoUpdatedAt: null,
		});
		renderSwitcher();

		await waitFor(() => expect(useSchoolScopeStore.getState().school).toBeNull());
	});
});
