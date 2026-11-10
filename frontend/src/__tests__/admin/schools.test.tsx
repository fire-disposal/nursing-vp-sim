import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import type { SchoolDetail, SchoolItem } from "@/api/admin/schools";
import SchoolDetailPage from "@/pages/people/SchoolDetailPage";
import SchoolsPage from "@/pages/people/SchoolsPage";

// 只替换网络边界；页面行为（加载/错误/404/空态/进入管理/链接）跑真实组件。
const getSchools = vi.fn();
const getSchoolDetail = vi.fn();
const setSchool = vi.fn();
const setActive = vi.fn();
const refreshUser = vi.fn();

vi.mock("@/api/admin/schools", () => ({
	getSchools: (...args: unknown[]) => getSchools(...args),
	getSchoolDetail: (...args: unknown[]) => getSchoolDetail(...args),
	createSchool: vi.fn(),
	updateSchool: vi.fn(),
	deleteSchool: vi.fn(),
	uploadSchoolLogo: vi.fn(),
	deleteSchoolLogo: vi.fn(),
}));

vi.mock("@/stores/authStore", () => {
	const state = { permissions: ["school_manage"], refreshUser: () => refreshUser() };
	const useAuthStore = Object.assign(() => state, { getState: () => state });
	return { default: useAuthStore };
});

vi.mock("@/stores/personaStore", () => {
	const state = { available: ["admin"], setActive: (id: string) => setActive(id) };
	const usePersonaStore = Object.assign(() => state, { getState: () => state });
	return { usePersonaStore };
});

vi.mock("@/stores/schoolScopeStore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/stores/schoolScopeStore")>();
	const state = { school: null as unknown, setSchool: (s: unknown) => setSchool(s) };
	const useSchoolScopeStore = Object.assign(
		(selector: (s: typeof state) => unknown) => selector(state),
		{ getState: () => state },
	);
	return { ...actual, useSchoolScopeStore };
});

// 额度弹窗按 id 拉全校预算表；本测试不关心它，避免真实网络。
vi.mock("@/components/admin/SchoolQuotaModal", () => ({
	default: ({ opened }: { opened: boolean }) =>
		opened ? <div data-testid="quota-modal">quota</div> : null,
}));

const SCHOOL_A: SchoolItem = {
	id: 1,
	name: "甲大学",
	class_count: 2,
	user_count: 5,
	admin_count: 1,
	theme_color: "teal",
	has_logo: false,
	logo_updated_at: null,
	created_at: "2026-01-02T03:04:05Z",
};

const SCHOOL_B: SchoolItem = {
	...SCHOOL_A,
	id: 2,
	name: "乙学院",
	class_count: 0,
	user_count: 0,
	admin_count: 0,
	theme_color: null,
};

const DETAIL_A: SchoolDetail = {
	...SCHOOL_A,
	llm_used: 12.5,
	tts_used: 2.5,
	llm_monthly_limit: 100,
	tts_monthly_limit: 0,
	default_daily_llm_limit: null,
	default_daily_tts_limit: 30,
	classes: [
		{
			id: 7,
			name: "甲一班",
			cohort_label: "2026级",
			student_count: 40,
			teacher_count: 2,
			created_at: "2026-01-05T00:00:00Z",
		},
	],
	class_total: 2,
};

function renderAt(ui: ReactElement, path: string, route: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path={route} element={ui} />
					<Route path="/admin/users" element={<div>用户管理页</div>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	refreshUser.mockResolvedValue(undefined);
});

describe("院校管理列表", () => {
	it("院校名是真链接，移动卡片也带「进入管理」", async () => {
		getSchools.mockResolvedValue({ data: [SCHOOL_A, SCHOOL_B] });
		renderAt(<SchoolsPage />, "/admin/schools", "/admin/schools");

		const links = await screen.findAllByRole("link", { name: "甲大学" });
		// 桌面表格与移动卡片各有一个真链接
		expect(links.length).toBeGreaterThanOrEqual(1);
		for (const link of links) expect(link).toHaveAttribute("href", "/admin/schools/1");

		// 桌面行 + 移动卡片各一个「进入管理」：两处都得有，移动端才不是死胡同
		const enterButtons = screen.getAllByRole("button", { name: "进入管理" });
		expect(enterButtons.length).toBeGreaterThanOrEqual(2);
	});

	it("列表失败显示错误与重试，不显示「暂无院校」", async () => {
		getSchools.mockRejectedValue(new Error("offline"));
		renderAt(<SchoolsPage />, "/admin/schools", "/admin/schools");

		expect(await screen.findByText("院校列表加载失败")).toBeVisible();
		expect(screen.queryByText("暂无院校")).not.toBeInTheDocument();
	});

	it("列表为空显示空态", async () => {
		getSchools.mockResolvedValue({ data: [] });
		renderAt(<SchoolsPage />, "/admin/schools", "/admin/schools");
		expect(await screen.findByText("暂无院校")).toBeVisible();
	});

	it("?edit=<id> 深链打开同一张编辑弹窗", async () => {
		getSchools.mockResolvedValue({ data: [SCHOOL_A, SCHOOL_B] });
		renderAt(<SchoolsPage />, "/admin/schools?edit=1", "/admin/schools");

		expect(await screen.findByRole("heading", { name: "编辑院校" })).toBeVisible();
		expect(screen.getByDisplayValue("甲大学")).toBeVisible();
	});

	it("移动端卡片的「进入管理」同样切校并跳转", async () => {
		getSchools.mockResolvedValue({ data: [SCHOOL_A] });
		const user = userEvent.setup();
		renderAt(<SchoolsPage />, "/admin/schools", "/admin/schools");

		// 卡片在 md 以下渲染；这里两个入口都在 DOM 里，取最后一个（列表卡片）
		const buttons = await screen.findAllByRole("button", { name: "进入管理" });
		await user.click(buttons[buttons.length - 1]);

		await waitFor(() => expect(refreshUser).toHaveBeenCalled());
		expect(setSchool).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1, name: "甲大学", themeColor: "teal" }),
		);
		expect(await screen.findByText("用户管理页")).toBeVisible();
	});
});

describe("院校详情", () => {
	it("渲染品牌、计数、用量额度与班级摘要", async () => {
		getSchoolDetail.mockResolvedValue({ data: DETAIL_A });
		renderAt(<SchoolDetailPage />, "/admin/schools/1", "/admin/schools/:schoolId");

		expect(await screen.findByRole("heading", { name: "甲大学" })).toBeVisible();
		expect(getSchoolDetail).toHaveBeenCalledWith(1);
		// 计数
		expect(screen.getByText("管理员")).toBeVisible();
		expect(screen.getByText("账号数")).toBeVisible();
		// 用量：有不限的 TTS 上限时不能画成满格进度条
		expect(screen.getByText("LLM 本月用量")).toBeVisible();
		expect(screen.getByText("不限（未设月度上限）")).toBeVisible();
		// 额度入口
		expect(screen.getByRole("button", { name: "调整额度" })).toBeVisible();
		// 班级摘要：纯文本（无 grade_class_manage 的平台视角点进班级只会 403），并显示总数
		expect(screen.getByText("甲一班")).toBeVisible();
		expect(screen.queryByRole("link", { name: "甲一班" })).not.toBeInTheDocument();
		expect(screen.getByText("显示前 1 / 共 2 个")).toBeVisible();
		// 主行动唯一：页头只有一个「进入管理」，页尾不再重复
		expect(screen.getAllByRole("button", { name: "进入管理" })).toHaveLength(1);
		// 平台视角不具备的权限页面一律不出链接
		expect(screen.queryByRole("link", { name: "成本与用量" })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "全部班级" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "返回院校管理" })).not.toBeInTheDocument();
	});

	it("管理员为 0 时给出提示，品牌为空时标明平台默认", async () => {
		getSchoolDetail.mockResolvedValue({ data: { ...DETAIL_A, admin_count: 0, theme_color: null, classes: [], class_total: 0 } });
		renderAt(<SchoolDetailPage />, "/admin/schools/1", "/admin/schools/:schoolId");

		expect(await screen.findByText("平台默认")).toBeVisible();
		expect(screen.getByText(/这所院校还没有管理员/)).toBeVisible();
		expect(screen.getByText(/这所院校还没有班级/)).toBeVisible();
	});

	it("404（不存在或越权）给不可重试的空态，而不是错误横幅", async () => {
		const err = Object.assign(new Error("not found"), {
			isAxiosError: true,
			response: { status: 404, data: { detail: "院校不存在" } },
		});
		getSchoolDetail.mockRejectedValue(err);
		renderAt(<SchoolDetailPage />, "/admin/schools/9", "/admin/schools/:schoolId");

		expect(await screen.findByText("院校不存在或无权访问")).toBeVisible();
		expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
	});

	it("网络失败给错误与重试（不伪装成不存在）", async () => {
		const err = Object.assign(new Error("boom"), {
			isAxiosError: true,
			response: { status: 500, data: {} },
		});
		getSchoolDetail.mockRejectedValue(err);
		renderAt(<SchoolDetailPage />, "/admin/schools/1", "/admin/schools/:schoolId");

		// 5xx 会按 query 默认策略重试一次（约 1s 退避），所以给足等待时间
		expect(await screen.findByText("院校详情加载失败", undefined, { timeout: 5000 })).toBeVisible();
		expect(screen.queryByText("院校不存在或无权访问")).not.toBeInTheDocument();
	});

	it("「进入管理」切到该校作用域、admin 视角并刷新权限后跳用户管理", async () => {
		getSchoolDetail.mockResolvedValue({ data: DETAIL_A });
		const user = userEvent.setup();
		renderAt(<SchoolDetailPage />, "/admin/schools/1", "/admin/schools/:schoolId");

		await screen.findByRole("heading", { name: "甲大学" });
		// 页头唯一主行动
		await user.click(screen.getByRole("button", { name: "进入管理" }));

		await waitFor(() => expect(refreshUser).toHaveBeenCalled());
		expect(setSchool).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1, name: "甲大学", themeColor: "teal" }),
		);
		expect(setActive).toHaveBeenCalledWith("admin");
		// 进入后落到用户管理（与列表行同一行为）
		expect(await screen.findByText("用户管理页")).toBeVisible();
	});
});
