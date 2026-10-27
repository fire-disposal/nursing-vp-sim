import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
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

function renderSwitcher() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<SchoolScopeSwitcher />
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
