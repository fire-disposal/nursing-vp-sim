import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CheckResponse } from "@/components/QuestionnaireModal";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";

function makeCheckResponse(
	overrides: Partial<CheckResponse> = {},
): CheckResponse {
	return {
		has_pending: true,
		template_id: 1,
		template: {
			id: 1,
			title: "前测问卷",
			description: "请如实填写",
			is_active: true,
			question_count: 2,
			response_count: 0,
			questions: [
				{
					id: 1,
					content: "李克特测试问题",
					question_type: "likert_5",
					required: true,
					sort_order: 0,
				},
				{
					id: 2,
					content: "多选题",
					question_type: "multiple_choice",
					required: false,
					sort_order: 1,
					options: ["A", "B", "C"],
				},
				{
					id: 3,
					content: "简答题",
					question_type: "short_text",
					required: false,
					sort_order: 2,
				},
			],
		},
		is_required: true,
		trigger_event: "before_training",
		...overrides,
	};
}

describe("QuestionnaireModal", () => {
	it("renders questions and title", () => {
		const checkResponse = makeCheckResponse();
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.getByText("前测问卷")).toBeInTheDocument();
		expect(screen.getByText("请如实填写")).toBeInTheDocument();
		expect(screen.getByText(/李克特测试问题/)).toBeInTheDocument();
		expect(screen.getByText(/多选题/)).toBeInTheDocument();
		expect(screen.getByText(/简答题/)).toBeInTheDocument();
	});

	it("shows required indicator on required questions", () => {
		const checkResponse = makeCheckResponse();
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={vi.fn()}
			/>,
		);

		const stars = screen.getAllByText("*");
		expect(stars.length).toBe(1);
	});

	it("shows skip button when not required", () => {
		const checkResponse = makeCheckResponse({ is_required: false });
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.getByText("跳过")).toBeInTheDocument();
	});

	it("hides skip button when required", () => {
		const checkResponse = makeCheckResponse({ is_required: true });
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.queryByText("跳过")).not.toBeInTheDocument();
	});

	it("calls onSkip when skip button clicked", async () => {
		const onSkip = vi.fn();
		const checkResponse = makeCheckResponse({ is_required: false });
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={onSkip}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={vi.fn()}
			/>,
		);

		await userEvent.click(screen.getByText("跳过"));
		expect(onSkip).toHaveBeenCalledTimes(1);
	});

	it("shows validation error when required question is not answered", async () => {
		const onSubmit = vi.fn();
		const checkResponse = makeCheckResponse({
			template: {
				...makeCheckResponse().template!,
				questions: [
					{
						id: 1,
						content: "必答题",
						question_type: "likert_5",
						required: true,
						sort_order: 0,
					},
				],
			},
		});

		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={onSubmit}
			/>,
		);

		await userEvent.click(screen.getByText("提交"));
		expect(screen.getByText(/请完成所有必答题/)).toBeInTheDocument();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("calls onSubmit with answers when all required questions answered", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const checkResponse = makeCheckResponse({
			template: {
				...makeCheckResponse().template!,
				questions: [
					{
						id: 1,
						content: "评分题",
						question_type: "likert_5",
						required: true,
						sort_order: 0,
					},
				],
			},
		});

		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={onSubmit}
			/>,
		);

		await userEvent.click(screen.getByText("3"));
		await userEvent.click(screen.getByText("提交"));

		expect(onSubmit).toHaveBeenCalledWith([
			{ question_id: 1, answer_value: "3" },
		]);
	});

	it("renders multiple choice options", () => {
		const checkResponse = makeCheckResponse();
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("B")).toBeInTheDocument();
		expect(screen.getByText("C")).toBeInTheDocument();
	});

	it("renders short text input", () => {
		const checkResponse = makeCheckResponse();
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={vi.fn()}
			/>,
		);

		expect(
			screen.getByPlaceholderText("请输入您的回答..."),
		).toBeInTheDocument();
	});

	it("shows loading state", () => {
		const checkResponse = makeCheckResponse();
		render(
			<QuestionnaireModal
				open={true}
				onComplete={vi.fn()}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={true}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.queryByText(/李克特测试问题/)).not.toBeInTheDocument();
	});

	it("calls onComplete after successful submit", async () => {
		const onComplete = vi.fn();
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const checkResponse = makeCheckResponse();

		render(
			<QuestionnaireModal
				open={true}
				onComplete={onComplete}
				onSkip={vi.fn()}
				checkResponse={checkResponse}
				loading={false}
				onSubmit={onSubmit}
			/>,
		);

		await userEvent.click(screen.getByText("3"));
		await userEvent.click(screen.getByText("提交"));

		await vi.waitFor(() => {
			expect(onComplete).toHaveBeenCalledTimes(1);
		});
	});
});
