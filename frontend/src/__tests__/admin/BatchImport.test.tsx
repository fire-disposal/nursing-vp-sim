import { fireEvent, render, screen } from "@/__tests__/render";
import { describe, expect, it, vi } from "vitest";
import BatchImport from "@/components/admin/users/BatchImport";
import type { ClassItem } from "@/types/store";

const ROLES = [{ name: "student", display_name: "学生" }];
const CLASSES: ClassItem[] = [
	{
		id: 1,
		name: "护理1班",
		cohort_label: "2024级",
		student_count: 0,
		teacher_count: 0,
		assignment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		name: "护理1班",
		cohort_label: "2025级",
		student_count: 0,
		teacher_count: 0,
		assignment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
	},
];

function renderImport(classes: ClassItem[] = CLASSES) {
	return render(
		<BatchImport
			open
			onClose={vi.fn()}
			roles={ROLES}
			classes={classes}
			isImporting={false}
			onImport={vi.fn()}
		/>,
	);
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
		expect(screen.queryByText(/将新建/)).not.toBeInTheDocument();
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
