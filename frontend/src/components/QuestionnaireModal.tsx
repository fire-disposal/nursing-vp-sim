import { Alert, Box, Button, Center, Group, Loader, Modal, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import { Textarea } from "@mantine/core";

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
	/**
	 * 题目不可用时的重试入口（重新发起 check / 拉取模板）。
	 * 不传则只显示失败说明，不提供重试按钮。
	 */
	onRetry?: () => void;
}

const LIKERT_LABELS = ["非常不同意", "不同意", "一般", "同意", "非常同意"];
const SATISFACTION_LABELS = ["非常不满意", "不满意", "一般", "满意", "非常满意"];

export function QuestionnaireModal({
	open,
	onComplete,
	onSkip,
	checkResponse,
	loading,
	onSubmit,
	onRetry,
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
	// 服务端说有待答问卷、题目却拿不到：**不能**静默返回 null，
	// 否则研究里会被误判成「学生跳过了问卷」。这里给出可见说明与重试入口。
	if (!template) {
		return (
			<Modal
				opened={open}
				onClose={() => {}}
				title="问卷加载失败"
				size={560}
				centered
				withinPortal
			>
				<Stack gap="md">
					<Alert
						variant="light"
						color="red"
						icon={<IconAlertTriangle size={18} />}
						title="未能加载问卷题目"
					>
						<Text size="sm">
							本次训练有需要你填写的问卷，但题目没有加载成功，你的作答尚未被记录。
							{checkResponse.is_required
								? "该问卷为必填，请重试后再继续训练。"
								: "你可以重试，或选择跳过。"}
						</Text>
					</Alert>
					<Group justify="flex-end" gap={8}>
						{!checkResponse.is_required && (
							<Button variant="subtle" color="gray" onClick={onSkip}>
								跳过
							</Button>
						)}
						{onRetry && (
							<Button onClick={onRetry} loading={loading}>
								重试
							</Button>
						)}
					</Group>
				</Stack>
			</Modal>
		);
	}

	return (
		<Modal opened={open} onClose={() => {}} title={template.title} size={700} centered withinPortal>
				<Stack gap="xl">
					{template.description && (
						<Text size="sm" c="dimmed">
							{template.description}
						</Text>
					)}

					{loading ? (
						<Center py="lg">
							<Loader size="md" />
						</Center>
					) : (
						<Stack gap="xl">
							{questions.map((q, idx) => (
								<Box
									key={q.id}
									p="md"
									style={{
										border: "1px solid var(--mantine-color-default-border)",
										borderRadius: "var(--mantine-radius-md)",
									}}
								>
									<Text component="label" size="sm" fw={500}>
										{idx + 1}. {q.content}
										{q.required && (
											<Text component="span" c="red" ml={4}>
												*
											</Text>
										)}
									</Text>

									{(q.question_type === "likert_5" || q.question_type === "satisfaction_5") && (
										<Group gap={8} mt="sm">
											{[1, 2, 3, 4, 5].map((val) => {
												const active = answers[q.id] === String(val);
												const labels =
													q.question_type === "likert_5"
														? LIKERT_LABELS
														: SATISFACTION_LABELS;
												return (
													<UnstyledButton
														key={val}
														onClick={() => handleAnswer(q.id, String(val))}
														style={{
															display: "flex",
															flexDirection: "column",
															alignItems: "center",
															gap: 4,
															padding: "8px 12px",
															borderRadius: "var(--mantine-radius-md)",
															border: active
																? "1px solid var(--mantine-color-blue-6)"
																: "1px solid var(--mantine-color-default-border)",
															background: active
																? "var(--mantine-color-blue-light)"
																: "transparent",
														}}
													>
														<Text size="lg" fw={600} c={active ? "blue.7" : undefined}>
															{val}
														</Text>
														<Text fz="xs" c="dimmed">
															{labels[val - 1]}
														</Text>
													</UnstyledButton>
												);
											})}
										</Group>
									)}

									{q.question_type === "multiple_choice" && q.options && (
										<Stack gap={6} mt="sm">
											{q.options.map((opt) => {
												const active = answers[q.id] === opt;
												return (
													<UnstyledButton
														key={opt}
														onClick={() => handleAnswer(q.id, opt)}
														style={{
															display: "flex",
															alignItems: "center",
															gap: 8,
															padding: "8px 12px",
															borderRadius: "var(--mantine-radius-md)",
															border: active
																? "1px solid var(--mantine-color-blue-6)"
																: "1px solid var(--mantine-color-default-border)",
															background: active
																? "var(--mantine-color-blue-light)"
																: "transparent",
															textAlign: "left",
														}}
													>
														<Box
															style={{
																width: 16,
																height: 16,
																borderRadius: "50%",
																border: "1px solid var(--mantine-color-default-border)",
																display: "flex",
																alignItems: "center",
																justifyContent: "center",
																flexShrink: 0,
															}}
														>
															{active && (
																<Box
																	style={{
																		width: 8,
																		height: 8,
																		borderRadius: "50%",
																		background: "var(--mantine-color-blue-6)",
																	}}
																/>
															)}
														</Box>
														<Text size="sm">{opt}</Text>
													</UnstyledButton>
												);
											})}
										</Stack>
									)}

									{q.question_type === "short_text" && (
										<Textarea
											value={answers[q.id] || ""}
											onChange={(e) => handleAnswer(q.id, e.target.value || null)}
											placeholder="请输入您的回答..."
											rows={3}
											mt="sm"
										/>
									)}
								</Box>
							))}
						</Stack>
					)}

					{error && (
						<Text
							size="sm"
							c="red"
							px="sm"
							py="xs"
							style={{
								background: "var(--mantine-color-red-light)",
								borderRadius: "var(--mantine-radius-md)",
							}}
						>
							{error}
						</Text>
					)}

					<Group justify="flex-end" gap={8} pt="xs">
						{!checkResponse.is_required && (
							<Button variant="subtle" color="gray" onClick={onSkip} disabled={submitting}>
								跳过
							</Button>
						)}
						<Button onClick={handleSubmit} disabled={submitting || loading}>
							{submitting ? (
								<>
									<Loader size={14} /> 提交中...
								</>
							) : (
								"提交"
							)}
						</Button>
					</Group>
				</Stack>
			</Modal>
	);
}
