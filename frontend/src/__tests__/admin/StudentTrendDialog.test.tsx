import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@/__tests__/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentTrendDialog from "@/components/admin/scoreboard/StudentTrendDialog";

const mocks = vi.hoisted(() => ({
	getStudentTrend: vi.fn(),
}));

vi.mock("@/api/scoreboard", () => ({
	getStudentTrend: mocks.getStudentTrend,
}));

const POLICY = {
	id: "nursing_history_grade",
	version: 1,
	calibrated: false,
	capability_available: false,
	capability_label: "尚未校准能力等第",
	capability_note: "能力等第需要教师校准裁判例后才能启用",
	numeric_bands: [{ band: "good", min: 85, label: "数值参考 · 高" }],
	numeric_band_description: "按展示分固定阈值分段",
};

function record(over: Record<string, unknown>) {
	return {
		record_id: 1,
		case_id: 1,
		case_name: "甲病例",
		assignment_id: null,
		assignment_title: null,
		score: 80,
		duration_seconds: 600,
		start_time: "2026-09-01T10:00:00",
		end_time: "2026-09-01T10:10:00",
		comparability_label: "甲病例 · 26 原始分",
		...over,
	};
}

function renderDialog() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<StudentTrendDialog open userId={7} scope={{}} onOpenChange={() => {}} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.getStudentTrend.mockResolvedValue({
		data: {
			user_id: 7,
			display_name: "学生甲",
			student_id: "S001",
			class_name: "一班",
			training_count: 2,
			total_duration_seconds: 1200,
			avg_score: 82.5,
			best_score: 88,
			first_score: 77,
			latest_score: 88,
			progress_delta: null,
			progress_trend: "none",
			records: [
				record({ record_id: 1, score: 77, comparability_label: "甲病例 · 26 原始分" }),
				record({ record_id: 2, score: 88, case_id: 2, case_name: "乙病例", comparability_label: "乙病例 · 38 原始分" }),
			],
			policy: POLICY,
			comparability: {
				mixed: true,
				single_group: false,
				identity_unknown_count: 0,
				groups: [
					{ label: "甲病例 · 26 原始分", count: 1, key: {} },
					{ label: "乙病例 · 38 原始分", count: 1, key: {} },
				],
			},
		},
	});
});

describe("成绩趋势对话框的来源与可比性口径", () => {
	it("跨可比组时不展示进步/退步结论，并列出可比组", async () => {
		renderDialog();

		expect(await screen.findByText("记录跨可比组，未计算进步幅度")).toBeInTheDocument();
		expect(screen.getByText(/甲病例 · 26 原始分（1 条）/)).toBeInTheDocument();
		expect(screen.getByText(/乙病例 · 38 原始分（1 条）/)).toBeInTheDocument();
		expect(screen.getByText("跨可比组，不计算")).toBeInTheDocument();
		expect(screen.queryByText(/进步幅度：/)).not.toBeInTheDocument();
	});

	it("数值标签与能力等第文案取自服务端 policy，不在页面上算分档", async () => {
		renderDialog();

		expect(await screen.findByText(/平均分 ≥ 85 为「数值参考 · 高」/)).toBeInTheDocument();
		expect(screen.getByText(/尚未校准能力等第/)).toBeInTheDocument();
		expect(screen.getByText("平均分（数值参考）")).toBeInTheDocument();
	});
});
