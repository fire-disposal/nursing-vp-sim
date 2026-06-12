import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import Button from "@/components/ui/Button";
import { Label } from "@/components/ui/label";
import Modal from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/textarea";

export interface QuestionItem {
	id: number;
	content: string;
	question_type: string;
	required: boolean;
	sort_order: number;
	options?: string[] | null;
}

export interface TemplateDetail {
	id: number;
	title: string;
	description?: string | null;
	is_active: boolean;
	question_count: number;
	response_count: number;
	questions: QuestionItem[];
}

export interface CheckResponse {
	has_pending: boolean;
	template_id?: number | null;
	response_id?: number | null;
	template?: TemplateDetail | null;
	is_required: boolean;
	trigger_event: string;
}

interface QuestionnaireModalProps {
	open: boolean;
	onComplete: () => void;
	onSkip: () => void;
	checkResponse: CheckResponse;
	loading: boolean;
	onSubmit: (
		answers: { question_id: number; answer_value: string | null }[],
	) => Promise<void>;
}

const LIKERT_LABELS = ["非常不同意", "不同意", "一般", "同意", "非常同意"];

export function QuestionnaireModal({
	open,
	onComplete,
	onSkip,
	checkResponse,
	loading,
	onSubmit,
}: QuestionnaireModalProps) {
	const [answers, setAnswers] = useState<Record<number, string | null>>({});
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const template = checkResponse.template;
	const questions = template?.questions || [];

	const handleAnswer = useCallback(
		(questionId: number, value: string | null) => {
			setAnswers((prev) => ({ ...prev, [questionId]: value }));
			setError(null);
		},
		[],
	);

	const handleSubmit = async () => {
		const missing = questions.filter((q) => q.required && !answers[q.id]);
		if (missing.length > 0) {
			setError(`请完成所有必答题（共 ${missing.length} 题未答）`);
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const answerList = questions.map((q) => ({
				question_id: q.id,
				answer_value: answers[q.id] ?? null,
			}));
			await onSubmit(answerList);
			onComplete();
		} catch {
			setError("提交失败，请重试");
		} finally {
			setSubmitting(false);
		}
	};

	if (!template) return null;

	return (
		<Modal open={open} onClose={() => {}} title={template.title} maxWidth={700}>
			<div className="space-y-6">
				{template.description && (
					<p className="text-sm text-muted-foreground">
						{template.description}
					</p>
				)}

				{loading ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<div className="space-y-6">
						{questions.map((q, idx) => (
							<div
								key={q.id}
								className="space-y-2 rounded-lg border border-border p-4"
							>
								<Label className="text-sm font-medium">
									{idx + 1}. {q.content}
									{q.required && (
										<span className="ml-1 text-destructive">*</span>
									)}
								</Label>

								{q.question_type === "likert_5" && (
									<div className="flex flex-wrap gap-2">
										{[1, 2, 3, 4, 5].map((val) => (
											<button
												key={val}
												type="button"
												onClick={() => handleAnswer(q.id, String(val))}
												className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-muted ${
													answers[q.id] === String(val)
														? "border-primary bg-primary/10 text-primary"
														: "border-border"
												}`}
											>
												<span className="text-lg font-semibold">{val}</span>
												<span className="text-[10px] text-muted-foreground">
													{LIKERT_LABELS[val - 1]}
												</span>
											</button>
										))}
									</div>
								)}

								{q.question_type === "multiple_choice" && q.options && (
									<div className="space-y-1.5">
										{q.options.map((opt) => (
											<label
												key={opt}
												className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors hover:bg-muted ${
													answers[q.id] === opt
														? "border-primary bg-primary/10"
														: "border-border"
												}`}
											>
												<input
													type="radio"
													name={`q-${q.id}`}
													value={opt}
													checked={answers[q.id] === opt}
													onChange={(e) => handleAnswer(q.id, e.target.value)}
													className="sr-only"
												/>
												<span className="flex h-4 w-4 items-center justify-center rounded-full border border-border">
													{answers[q.id] === opt && (
														<span className="h-2 w-2 rounded-full bg-primary" />
													)}
												</span>
												{opt}
											</label>
										))}
									</div>
								)}

								{q.question_type === "short_text" && (
									<Textarea
										value={answers[q.id] || ""}
										onChange={(e) => handleAnswer(q.id, e.target.value || null)}
										placeholder="请输入您的回答..."
										rows={3}
										className="resize-none"
									/>
								)}
							</div>
						))}
					</div>
				)}

				{error && (
					<p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
						{error}
					</p>
				)}

				<div className="flex items-center justify-end gap-2 pt-2">
					{!checkResponse.is_required && (
						<Button variant="ghost" onClick={onSkip} disabled={submitting}>
							跳过
						</Button>
					)}
					<Button onClick={handleSubmit} disabled={submitting || loading}>
						{submitting ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								提交中...
							</>
						) : (
							"提交"
						)}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
