import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SchoolsPage from "@/pages/admin/SchoolsPage";

const mocks = vi.hoisted(() => ({
	getSchools: vi.fn(),
	createSchool: vi.fn(),
	updateSchool: vi.fn(),
	deleteSchool: vi.fn(),
	uploadSchoolLogo: vi.fn(),
	deleteSchoolLogo: vi.fn(),
}));

vi.mock("@/api/admin/schools", () => ({
	getSchools: mocks.getSchools,
	createSchool: mocks.createSchool,
	updateSchool: mocks.updateSchool,
	deleteSchool: mocks.deleteSchool,
	uploadSchoolLogo: mocks.uploadSchoolLogo,
	deleteSchoolLogo: mocks.deleteSchoolLogo,
}));

const SCHOOL = {
	id: 7,
	name: "杭州师范大学",
	class_count: 2,
	user_count: 3,
	admin_count: 1,
	theme_color: null,
	has_logo: false,
	logo_updated_at: null,
	created_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/admin/schools"]}>
				<SchoolsPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSchools.mockResolvedValue({ data: [SCHOOL] });
	mocks.updateSchool.mockResolvedValue({ data: SCHOOL });
	mocks.createSchool.mockResolvedValue({ data: SCHOOL });
	mocks.uploadSchoolLogo.mockResolvedValue({ data: { ...SCHOOL, has_logo: true } });
	mocks.deleteSchoolLogo.mockResolvedValue({ data: SCHOOL });
});

describe("院校品牌（可选主题色 / 可选院徽）", () => {
	it("主题色随编辑保存提交（调色板键，不是任意 hex）", async () => {
		renderPage();
		await screen.findAllByText("杭州师范大学");
		// ResponsiveTable 同时渲染表格与移动端卡片 → 同一操作有两个入口，取第一个
		await userEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);

		await userEvent.click(screen.getByRole("button", { name: "主题色：靛蓝" }));
		await userEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(mocks.updateSchool).toHaveBeenCalledWith(7, {
				name: "杭州师范大学",
				theme_color: "indigo",
			}),
		);
	});

	it("院徽上传走独立接口（选图即传，不混进表单提交）", async () => {
		renderPage();
		await screen.findAllByText("杭州师范大学");
		// ResponsiveTable 同时渲染表格与移动端卡片 → 同一操作有两个入口，取第一个
		await userEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);

		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
		await userEvent.upload(input, file);

		await waitFor(() => expect(mocks.uploadSchoolLogo).toHaveBeenCalledWith(7, file));
		expect(mocks.updateSchool).not.toHaveBeenCalled();
	});
});
