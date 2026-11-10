import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserImportPage from "@/pages/people/UserImportPage";
import { fireEvent, render, screen, waitFor } from "../render";

const mocks = vi.hoisted(() => ({
	getClasses: vi.fn(),
	previewBatchUsers: vi.fn(),
	batchCreateUsers: vi.fn(),
}));

vi.mock("@/api", () => ({
	getClasses: mocks.getClasses,
}));
vi.mock("@/api/admin/users", () => ({
	batchCreateUsers: mocks.batchCreateUsers,
	previewBatchUsers: mocks.previewBatchUsers,
}));

const CLASSES = [
	{
		id: 7,
		name: "护理241",
		cohort_label: "2024级",
		school_name: "杭州师范大学",
		student_count: 0,
	},
];

function LocationProbe() {
	const location = useLocation();
	return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(path = "/admin/users/import") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route
						path="/admin/users/import"
						element={
							<>
								<LocationProbe />
								<UserImportPage />
							</>
						}
					/>
					<Route path="/admin/users" element={<LocationProbe />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

const ROW = "student01,123456,张三,student,S2024001,杭州师范大学,2024级,护理241";

async function pasteOneRow() {
	fireEvent.change(await screen.findByLabelText("批量导入文本"), {
		target: { value: `用户名,密码,姓名,视角,学号,学校,届别,班级名称\n${ROW}` },
	});
}

describe("用户批量导入页", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getClasses.mockResolvedValue({ data: CLASSES });
		mocks.previewBatchUsers.mockResolvedValue({
			data: {
				create: 1,
				link: 0,
				skip: 0,
				rows: [
					{
						username: "student01",
						action: "create",
					},
				],
			},
		});
		mocks.batchCreateUsers.mockResolvedValue({
			data: {
				created: 1,
				linked: 0,
				skipped: 1,
				skipped_rows: [{ index: 1, username: "student02", reason: "学号相同但姓名不同" }],
			},
		});
	});

	it("班级加载失败时显示错误与重试，不渲染导入表单", async () => {
		mocks.getClasses.mockRejectedValue(new Error("offline"));
		renderPage();
		expect(await screen.findByText("班级列表加载失败")).toBeVisible();
		expect(screen.queryByLabelText("批量导入文本")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => expect(mocks.getClasses).toHaveBeenCalledTimes(2));
	});

	it("空态显示引导，粘贴后解析出预览行", async () => {
		renderPage();
		expect(await screen.findByText("还没有导入内容")).toBeVisible();
		await pasteOneRow();
		// 「看到内容」= 预览表格出现且预检按钮可点
		expect(await screen.findByText("预览（1 名学生）")).toBeVisible();
		expect(screen.getByRole("button", { name: /导入 1 名学生/ })).toBeDisabled();
	});

	it("未预检不能提交，预检后导入成功保留完整回执", async () => {
		renderPage();
		await pasteOneRow();
		const importButton = await screen.findByRole("button", { name: /导入 1 名学生/ });
		expect(importButton).toBeDisabled();
		fireEvent.click(importButton);
		expect(mocks.batchCreateUsers).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "预检" }));
		await waitFor(() => expect(mocks.previewBatchUsers).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /导入 1 名学生/ })).toBeEnabled(),
		);

		fireEvent.click(screen.getByRole("button", { name: /导入 1 名学生/ }));
		expect(await screen.findByText("导入部分完成")).toBeVisible();
		// 逐行被丢的原因按 CSV 行号回显，成功后可回用户列表
		expect(screen.getByText(/第2行 student02: 学号相同但姓名不同/)).toBeVisible();
		expect(screen.getByRole("link", { name: "返回用户列表" })).toHaveAttribute(
			"href",
			"/admin/users",
		);
	});

	it("导入失败保留预检结果与输入，可直接重试", async () => {
		mocks.batchCreateUsers.mockRejectedValue({
			response: { status: 500, data: { detail: "批量导入服务暂时不可用" } },
		});
		renderPage();
		await pasteOneRow();
		fireEvent.click(await screen.findByRole("button", { name: "预检" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /导入 1 名学生/ })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: /导入 1 名学生/ }));

		expect(await screen.findByText("批量导入服务暂时不可用")).toBeVisible();
		expect(screen.queryByText("导入完成")).not.toBeInTheDocument();
		// 名单与预检结论都还在：按钮仍可再次提交
		expect(screen.getByText("预览（1 名学生）")).toBeVisible();
		expect(screen.getByRole("button", { name: /导入 1 名学生/ })).toBeEnabled();
	});

	it("校验失败的行不进入预览，并逐行列出原因", async () => {
		renderPage();
		fireEvent.change(await screen.findByLabelText("批量导入文本"), {
			target: { value: "用户名,密码,姓名\nstudent01,123,张三" },
		});
		expect(await screen.findByText(/未通过校验 1 行/)).toBeVisible();
		expect(screen.getByText(/第2行\(student01\): 密码长度不能少于6位/)).toBeVisible();
		expect(screen.queryByText(/预览（/)).not.toBeInTheDocument();
	});

	it("有未提交输入时，点「用户列表」先确认；取消则留在本页", async () => {
		renderPage();
		await pasteOneRow();
		expect(await screen.findByText("预览（1 名学生）")).toBeVisible();
		fireEvent.click(screen.getByRole("link", { name: "用户列表" }));
		expect(await screen.findByText("离开批量导入")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() =>
			expect(screen.getByTestId("location")).toHaveTextContent("/admin/users/import"),
		);
	});

	it("没有未提交输入时「用户列表」直接跳转", async () => {
		renderPage();
		expect(await screen.findByText("还没有导入内容")).toBeVisible();
		fireEvent.click(screen.getByRole("link", { name: "用户列表" }));
		await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/users"));
	});

	it("选定目标班级后，省略班级列的名单自动归入该班", async () => {
		renderPage("/admin/users/import?class_id=7");
		fireEvent.change(await screen.findByLabelText("批量导入文本"), {
			target: {
				value: "用户名,密码,姓名,学号,视角\nstudent09,123456,王五,S2024009,student",
			},
		});
		expect(await screen.findByText("预览（1 名学生）")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "预检" }));
		await waitFor(() => expect(mocks.previewBatchUsers).toHaveBeenCalledTimes(1));
		expect(mocks.previewBatchUsers.mock.calls[0][0][0]).toEqual(
			expect.objectContaining({
				username: "student09",
				school_name: "杭州师范大学",
				cohort_label: "2024级",
				class_name: "护理241",
				class_id: 7,
			}),
		);
	});

	it("目标班级已选定后，行内写其他班级会被拒绝而不是串班", async () => {
		renderPage("/admin/users/import?class_id=7");
		fireEvent.change(await screen.findByLabelText("批量导入文本"), {
			target: { value: `用户名,密码,姓名,视角,学号,学校,届别,班级名称\n${ROW.replace("护理241", "护理242")}` },
		});
		expect(await screen.findByText(/该行的学校\/届别\/班级与目标班不一致/)).toBeVisible();
		expect(screen.queryByText(/预览（/)).not.toBeInTheDocument();
	});
});
