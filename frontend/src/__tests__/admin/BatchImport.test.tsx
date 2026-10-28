import { fireEvent, render, screen, waitFor } from "@/__tests__/render";
import { describe, expect, it, vi } from "vitest";
import BatchImport from "@/components/admin/users/BatchImport";
import type { ClassItem } from "@/types/store";
import type { BatchCreateResult, BatchPreviewResult, BatchUser } from "@/components/admin/users/types";

const ROLES = [{ name: "student", display_name: "学生" }];
const CLASSES: ClassItem[] = [
	{
		id: 1,
		name: "护理1班",
		school_id: 1,
		school_name: "杭州师范大学",
		cohort_label: "2024级",
		student_count: 0,
		teacher_count: 0,
		assignment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		name: "护理1班",
		school_id: 1,
		school_name: "杭州师范大学",
		cohort_label: "2025级",
		student_count: 0,
		teacher_count: 0,
		assignment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 6,
		name: "护理241",
		school_id: 4,
		school_name: "杭州职业技术大学",
		cohort_label: "2024级",
		student_count: 0,
		teacher_count: 0,
		assignment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
	},
];

const OK: BatchCreateResult = { created: 1, linked: 0, skipped: 0, skipped_rows: [] };

/** 默认预检：全部新建（导入用例只关心提交阶段，预检判定另有后端测试覆盖）。 */
function planAllCreate(users: BatchUser[]): BatchPreviewResult {
	return {
		create: users.length,
		link: 0,
		skip: 0,
		rows: users.map((u, i) => ({
			index: i + 1,
			username: u.username,
			display_name: u.display_name,
			student_id: u.student_id,
			action: "create",
			will_create_class: u.class_id == null && !!u.class_name,
		})),
	};
}

function renderImport(
	classes: ClassItem[] = CLASSES,
	onImport: (users: BatchUser[]) => Promise<BatchCreateResult> = vi.fn(async () => OK),
	onPreview: (users: BatchUser[]) => Promise<BatchPreviewResult> = vi.fn(
		async (users: BatchUser[]) => planAllCreate(users),
	),
) {
	return render(
		<BatchImport
			open
			onClose={vi.fn()}
			roles={ROLES}
			classes={classes}
			onImport={onImport}
			onPreview={onPreview}
		/>,
	);
}

/** 防呆路径：先预检，等按钮解禁再提交（未预检时导入按钮是禁用的）。 */
async function submitImport(count: number) {
	fireEvent.click(screen.getByRole("button", { name: "预检" }));
	const button = screen.getByRole("button", { name: `导入 ${count} 名学生` });
	await waitFor(() => expect(button).toBeEnabled());
	fireEvent.click(button);
}

function paste(rows: string[]) {
	fireEvent.change(screen.getByRole("textbox"), {
		target: { value: rows.join("\n") },
	});
}

describe("BatchImport 班级消歧", () => {
	it("同名班级跨届别且未填届别时逐行报错，不静默挑一条", () => {
		renderImport();

		paste([
			"用户名,密码,姓名,角色,学号,届别,班级名称",
			"s1,123456,张三,student,S1,,护理1班",
		]);

		expect(screen.getAllByText(/存在于多个届别/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/第2行/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/预览（1 名学生）/)).not.toBeInTheDocument();
	});

	it("填写届别后可消歧并命中已存在班级", () => {
		renderImport();

		paste([
			"用户名,密码,姓名,角色,学号,届别,班级名称",
			"s1,123456,张三,student,S1,2024级,护理1班",
		]);

		expect(screen.getByText(/预览（1 名学生）/)).toBeInTheDocument();
		expect(screen.getByText("2024级 护理1班")).toBeInTheDocument();
		expect(screen.queryByText("2024级 护理1班（将新建）")).not.toBeInTheDocument();
	});

	it("「学校」列会解析进预览并随导入提交", async () => {
		const onImport = vi.fn(async () => OK);
		renderImport(CLASSES, onImport);

		paste([
			"用户名,密码,姓名,角色,学号,学校,届别,班级名称",
			"s1,123456,张三,student,S1,杭州师范大学,2024级,护理1班",
		]);

		expect(screen.getByText(/预览（1 名学生）/)).toBeInTheDocument();
		expect(screen.getByText("杭州师范大学")).toBeInTheDocument();

		await submitImport(1);
		expect(onImport).toHaveBeenCalledWith([
			expect.objectContaining({ school_name: "杭州师范大学", class_id: 1 }),
		]);
	});

	it("班级不存在时标注将新建", () => {
		renderImport();

		paste([
			"用户名,密码,姓名,角色,学号,届别,班级名称",
			"s1,123456,张三,student,S1,2026级,护理9班",
		]);

		expect(screen.getByText("2026级 护理9班（将新建）")).toBeInTheDocument();
	});
});

describe("BatchImport 跨院校同名班级（2026-10-28 生产事故）", () => {
	it("「护理241」只存在于别的院校时不在本校绑定它，交给后端新建", async () => {
		const onImport = vi.fn(async () => OK);
		renderImport(CLASSES, onImport);

		paste([
			"用户名,密码,姓名,角色,学号,学校,届别,班级名称",
			"s1,123456,张三,student,S1,杭州师范大学,2024级,护理241",
		]);

		// 若按名字跨院校匹配，这里会绑上杭州职业技术大学的 6 号班，整批被后端拒掉。
		expect(screen.getByText("2024级 护理241（将新建）")).toBeInTheDocument();

		await submitImport(1);
		expect(onImport).toHaveBeenCalledWith([
			expect.objectContaining({ class_id: null, school_name: "杭州师范大学", class_name: "护理241" }),
		]);
	});

	it("未填「学校」而同名班级分布在多所院校时报错，不静默挑一条", () => {
		renderImport([
			...CLASSES,
			{ ...CLASSES[2], id: 9, school_id: 1, school_name: "杭州师范大学" },
		]);

		paste([
			"用户名,密码,姓名,角色,学号,届别,班级名称",
			"s1,123456,张三,student,S1,2024级,护理241",
		]);

		expect(screen.getAllByText(/存在于多个院校/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/预览（1 名学生）/)).not.toBeInTheDocument();
	});
});

describe("BatchImport 混合行的解析与提交", () => {
	it("前半行非法、后半行合法时，后半仍全部进预览并提交", async () => {
		const onImport = vi.fn(async (_users: BatchUser[]) => OK);
		renderImport(CLASSES, onImport);

		paste([
			"用户名,密码,姓名,角色,学号,学校,届别,班级名称",
			"bad1,123,张一,student,S1,杭州师范大学,2024级,护理1班", // 第2行：密码太短
			"bad2,123456,张二,teacher,S2,杭州师范大学,2024级,护理1班", // 第3行：角色非学生
			",123456,张三,student,S3,杭州师范大学,2024级,护理1班", // 第4行：缺用户名
			"ok4,123456,李四,student,S4,杭州师范大学,2024级,护理1班",
			"ok5,123456,王五,student,S5,杭州师范大学,2024级,护理1班",
			"ok6,123456,赵六,student,S6,杭州师范大学,2024级,护理1班",
		]);

		expect(screen.getByText(/预览（3 名学生）/)).toBeInTheDocument();
		expect(screen.getByText(/未通过校验 3 行/)).toBeInTheDocument();
		expect(screen.getByText(/第2行\(bad1\): 密码长度不能少于6位/)).toBeInTheDocument();
		expect(screen.getByText(/第3行\(bad2\): 仅支持学生角色/)).toBeInTheDocument();
		expect(screen.getByText(/第4行\(\?\): 用户名\/密码\/姓名不能为空/)).toBeInTheDocument();

		await submitImport(3);
		expect(onImport).toHaveBeenCalledTimes(1);
		expect(onImport.mock.calls[0][0].map((u) => u.username)).toEqual(["ok4", "ok5", "ok6"]);
	});

	it("校验错误全部列出（不再截断到 10 条）", () => {
		renderImport();

		const rows = ["用户名,密码,姓名,角色,学号,学校,届别,班级名称"];
		for (let i = 1; i <= 12; i++) {
			rows.push(`bad${i},123,张${i},student,S${i},杭州师范大学,2024级,护理1班`);
		}
		paste(rows);

		expect(screen.getByText(/未通过校验 12 行/)).toBeInTheDocument();
		expect(screen.getAllByText(/密码长度不能少于6位/)).toHaveLength(12);
		expect(screen.queryByText(/还有 \d+ 个错误/)).not.toBeInTheDocument();
	});

	it("BOM、CRLF、引号内逗号、缺列的表头都能解析", () => {
		const onImport = vi.fn(async () => OK);
		renderImport(CLASSES, onImport);

		fireEvent.change(screen.getByRole("textbox"), {
			target: {
				value:
					"\uFEFF用户名,密码,姓名,学号,学校,届别,班级名称\r\n" +
					's1,123456,"张,三",S1,杭州师范大学,2024级,护理1班\r\n' +
					"\r\n" +
					"s2,123456,李四,S2,杭州师范大学,2024级,护理1班\r\n",
			},
		});

		expect(screen.getByText(/预览（2 名学生）/)).toBeInTheDocument();
		expect(screen.getByText("张,三")).toBeInTheDocument();
		expect(screen.queryByText(/未通过校验/)).not.toBeInTheDocument();
	});
});

describe("BatchImport 导入回执", () => {
	it("部分跳过时逐行给出 CSV 行号与原因，不只报一个成功数", async () => {
		const onImport = vi.fn(async (): Promise<BatchCreateResult> => ({
			created: 2,
			linked: 0,
			skipped: 1,
			skipped_rows: [{ index: 3, username: "s3", reason: "用户名已存在" }],
		}));
		renderImport(CLASSES, onImport);

		paste([
			"用户名,密码,姓名,角色,学号,学校,届别,班级名称",
			"s1,123456,张三,student,S1,杭州师范大学,2024级,护理1班",
			"s2,123456,李四,student,S2,杭州师范大学,2024级,护理1班",
			"s3,123456,王五,student,S3,杭州师范大学,2024级,护理1班",
		]);
		await submitImport(3);

		expect(await screen.findByText(/导入部分完成/)).toBeInTheDocument();
		expect(
			screen.getByText(/新建 2 人 · 并入既有账号 0 人 · 跳过 1 人 · 提交 3 行/),
		).toBeInTheDocument();
		// index=3 是提交顺序的第 3 行 → CSV 第 4 行（表头占第 1 行）
		expect(screen.getByText(/第4行 s3: 用户名已存在/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
	});

	it("整批成功时不出现失败明细", async () => {
		renderImport(CLASSES, vi.fn(async () => ({ ...OK, created: 1 })));

		paste(["用户名,密码,姓名,角色,学号,学校,届别,班级名称", "s1,123456,张三,student,S1,杭州师范大学,2024级,护理1班"]);
		await submitImport(1);

		expect(await screen.findByText(/导入完成/)).toBeInTheDocument();
		expect(
			screen.getByText(/新建 1 人 · 并入既有账号 0 人 · 跳过 0 人 · 提交 1 行/),
		).toBeInTheDocument();
		expect(screen.queryByText(/未入库 \d+ 行/)).not.toBeInTheDocument();
	});

	it("后端整体报错时留在弹窗里显示原因，不静默关闭", async () => {
		renderImport(
			CLASSES,
			vi.fn(async () => {
				throw { response: { status: 400, data: { detail: "单次最多导入 500 个用户，当前 501 个" } } };
			}),
		);

		paste(["用户名,密码,姓名,角色,学号,学校,届别,班级名称", "s1,123456,张三,student,S1,杭州师范大学,2024级,护理1班"]);
		await submitImport(1);

		expect(await screen.findByText(/单次最多导入 500 个用户/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /导入 1 名学生/ })).toBeEnabled();
	});
});
