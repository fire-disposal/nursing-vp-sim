import { IconAlertCircle, IconChevronDown, IconCircleCheck, IconCircleX, IconHelpCircle, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Box, Group, Text } from "@mantine/core";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";

interface QuizQuestion {
	id: string;
	stem: string;
	options: Array<{ key: string; text: string }>;
}

interface QuizConfig {
	title?: string;
	questions?: QuizQuestion[];
}

const LOAD_TIMEOUT_MS = 8000;
const SUBMIT_TIMEOUT_MS = 10000;

/** Map option state → style tokens for option button */
function optionStyle(
	selected: string | undefined,
	optKey: string,
	isCorrectAnswer: boolean,
): CSSProperties {
	if (!selected) {
		return {
			background: "var(--mantine-color-gray-0)",
			borderColor: "var(--mantine-color-default-border)",
			cursor: "pointer",
		};
	}
	if (isCorrectAnswer) {
		return {
			background: "var(--mantine-color-green-0)",
			borderColor: "var(--mantine-color-green-4)",
		};
	}
	if (selected === optKey && !isCorrectAnswer) {
		return {
			background: "var(--mantine-color-red-0)",
			borderColor: "var(--mantine-color-red-4)",
		};
	}
	return {
		background: "var(--mantine-color-gray-0)",
		borderColor: "var(--mantine-color-default-border)",
		opacity: 0.5,
	};
}

export default function QuizTool(props: TrainingToolProps) {
	const { bus, recordId } = props;
	const rid = Number(recordId);

	const [quiz, setQuiz] = useState<QuizConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [correctFlags, setCorrectFlags] = useState<Record<string, boolean>>({});
	const [correctAnswers, setCorrectAnswers] = useState<Record<string, string>>({});
	const [explanations, setExplanations] = useState<Record<string, string>>({});
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [submittingId, setSubmittingId] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<Record<string, string>>({});

	const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const answersRef = useRef(answers);
	answersRef.current = answers;

	useEffect(() => {
		const unsub = subscribeWSConnection((connected) => {
			if (connected) {
				bus.emit("tool:invoke", { tool: "quiz", action: "load", params: {}, recordId: rid });
				loadTimerRef.current = setTimeout(() => {
					setLoading(false);
					setLoadError("加载题目超时");
				}, LOAD_TIMEOUT_MS);
			}
		});
		return () => {
			unsub();
			if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
		};
	}, [bus, rid]);

	// ── Handle tool results ──
	useEffect(() => {
		const onResult = (payload: {
			tool: string;
			action: string;
			ok: boolean;
			data: Record<string, unknown>;
			error?: string;
		}) => {
			if (payload.tool !== "quiz") return;

			if (payload.action === "load") {
				if (loadTimerRef.current) {
					clearTimeout(loadTimerRef.current);
					loadTimerRef.current = null;
				}
				if (payload.ok) {
					setQuiz((payload.data.quiz as QuizConfig) ?? null);
				} else {
					setLoadError(payload.error || "加载题目失败");
				}
				setLoading(false);
			}

			if (payload.action === "submit") {
				const qid = payload.data.question_id as string;
				if (!qid) return;
				if (submitTimerRef.current) {
					clearTimeout(submitTimerRef.current);
					submitTimerRef.current = null;
				}
				setSubmittingId(null);
				if (payload.ok) {
					setCorrectFlags((prev) => ({ ...prev, [qid]: !!payload.data.correct }));
					const correctKey = payload.data.correct_answer;
					if (typeof correctKey === "string") {
						setCorrectAnswers((prev) => ({ ...prev, [qid]: correctKey }));
					}
					const expl = payload.data.explanation;
					if (typeof expl === "string" && expl) {
						setExplanations((prev) => ({ ...prev, [qid]: expl }));
					}
					setSubmitError((prev) => {
						const n = { ...prev };
						delete n[qid];
						return n;
					});
				} else {
					setSubmitError((prev) => ({
						...prev,
						[qid]: payload.error || "提交失败",
					}));
				}
			}
		};
		bus.on("tool:result", onResult);
		return () => {
			bus.off("tool:result", onResult);
			if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
			if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
		};
	}, [bus]);

	const selectOption = useCallback(
		(questionId: string, key: string) => {
			if (answersRef.current[questionId]) return;
			setAnswers((prev) => ({ ...prev, [questionId]: key }));
			setExpanded((prev) => ({ ...prev, [questionId]: true }));
			setSubmitError((prev) => {
				const n = { ...prev };
				delete n[questionId];
				return n;
			});
			if (rid > 0) {
				setSubmittingId(questionId);
				if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
				submitTimerRef.current = setTimeout(() => {
					setSubmittingId(null);
					setSubmitError((prev) => ({
						...prev,
						[questionId]: "提交超时，请检查网络后重试",
					}));
				}, SUBMIT_TIMEOUT_MS);
				bus.emit("tool:invoke", {
					tool: "quiz",
					action: "submit",
					params: { question_id: questionId, answer: key },
					recordId: rid,
				});
			}
		},
		[rid, bus],
	);

	const toggleExplanation = (questionId: string) => {
		setExpanded((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
	};

	// ── Loading state ──
	if (loading) {
		return (
			<Group h={128} justify="center" align="center" wrap="nowrap" c="dimmed" gap={8}>
				<IconLoader2 size={18} className="animate-spin" />
				<Text size="xs">加载题目…</Text>
			</Group>
		);
	}

	// ── Error state ──
	if (loadError) {
		return (
			<Box style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 24, textAlign: "center" }}>
				<IconAlertCircle size={24} style={{ opacity: 0.4, color: "var(--mantine-color-dimmed)" }} />
				<Text size="xs" c="dimmed">{loadError}</Text>
			</Box>
		);
	}

	const questions = quiz?.questions ?? [];

	// ── Empty state ──
	if (questions.length === 0) {
		return (
			<Box style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 24, textAlign: "center" }}>
				<IconHelpCircle size={24} style={{ opacity: 0.4, color: "var(--mantine-color-dimmed)" }} />
				<Text size="xs" c="dimmed">该病例未配置引导题目</Text>
			</Box>
		);
	}

	const answeredCount = Object.keys(answers).length;

	return (
		<Box style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--mantine-color-body)" }}>
			<Group
				justify="space-between"
				wrap="nowrap"
				px="sm"
				py={10}
				style={{ borderBottom: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}
			>
				<Text size="xs" fw={600}>
					{quiz?.title ?? "引导题目"}
				</Text>
				<Text size="10px" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
					{answeredCount}/{questions.length}
				</Text>
			</Group>

			<Box style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>
				{questions.map((q, qi) => {
					const selected = answers[q.id];
					const isCorrect = correctFlags[q.id] ?? false;
					// Only show correctness after backend confirms (no client-side fallback)
					const hasResult = correctFlags[q.id] !== undefined;
					const showExplanation = expanded[q.id];
					const correctKey = correctAnswers[q.id];

					return (
						<Box
							key={q.id}
							p="sm"
							style={{
								borderRadius: 12,
								border: "1px solid var(--mantine-color-default-border)",
								background:
									hasResult
										? isCorrect
											? "var(--mantine-color-green-0)"
											: "var(--mantine-color-red-0)"
										: "var(--mantine-color-body)",
								borderColor: hasResult
									? isCorrect
										? "var(--mantine-color-green-4)"
										: "var(--mantine-color-red-4)"
									: undefined,
							}}
						>
							<Group align="flex-start" gap={8} wrap="nowrap">
								<Text size="10px" fw={600} c="dimmed" mt={2} style={{ flexShrink: 0 }}>
									Q{qi + 1}
								</Text>
								<Text size="sm" fw={500} lh={1.4} style={{ flex: 1 }}>
									{q.stem}
								</Text>
								{submittingId === q.id ? (
									<IconLoader2 size={14} className="animate-spin" style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
								) : (
									hasResult && (
										<Box style={{ flexShrink: 0 }}>
											{isCorrect ? (
												<IconCircleCheck size={14} style={{ color: "var(--mantine-color-green-6)" }} />
											) : (
												<IconCircleX size={14} style={{ color: "var(--mantine-color-red-5)" }} />
											)}
										</Box>
									)
								)}
							</Group>

							<Box mt={10} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
								{q.options.map((opt) => {
									const isSelected = selected === opt.key;
									const isAnswer = hasResult && correctKey === opt.key;
									const style = optionStyle(
										hasResult ? undefined : selected,
										opt.key,
										isAnswer,
									);

									return (
										<Box
											key={opt.key}
											component="button"
											type="button"
											disabled={!!selected}
											onClick={() => selectOption(q.id, opt.key)}
											style={{
												width: "100%",
												display: "flex",
												alignItems: "center",
												gap: 8,
												padding: "8px 12px",
												borderRadius: 8,
												border: "1px solid var(--mantine-color-default-border)",
												fontSize: 12,
												textAlign: "left",
												cursor: selected ? "default" : "pointer",
												...style,
											}}
										>
											<Box
												w={16}
												h={16}
												style={{
													flexShrink: 0,
													borderRadius: 999,
													border: "1px solid var(--mantine-color-gray-4)",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													fontSize: 10,
													fontWeight: 600,
													background: isAnswer
														? "var(--mantine-color-green-5)"
														: isSelected && hasResult && !isCorrect
															? "var(--mantine-color-red-5)"
															: "transparent",
													borderColor: isAnswer
														? "var(--mantine-color-green-5)"
														: isSelected && hasResult && !isCorrect
															? "var(--mantine-color-red-5)"
															: undefined,
													color: isAnswer || (isSelected && hasResult && !isCorrect) ? "white" : "var(--mantine-color-dimmed)",
												}}
											>
												{isAnswer ? (
													<IconCircleCheck size={10} />
												) : isSelected && hasResult && !isCorrect ? (
													<IconCircleX size={10} />
												) : (
													opt.key
												)}
											</Box>
											<Text
												component="span"
												size="xs"
												style={{
													flex: 1,
													fontWeight: isAnswer ? 500 : undefined,
													color: isAnswer
														? "var(--mantine-color-green-7)"
														: isSelected && hasResult && !isCorrect
															? "var(--mantine-color-red-7)"
															: "var(--mantine-color-text)",
													textDecoration: isSelected && hasResult && !isCorrect ? "line-through" : undefined,
												}}
											>
												{opt.text}
											</Text>
											{isAnswer && isSelected && !isCorrect && (
												<Text component="span" size="10px" fw={500} c="green.6">正确答案</Text>
											)}
										</Box>
									);
								})}
							</Box>

							{selected && explanations[q.id] && (
								<>
									<Box
										component="button"
										type="button"
										onClick={() => toggleExplanation(q.id)}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 4,
											marginTop: 8,
											fontSize: 10,
											color: "var(--mantine-color-dimmed)",
											background: "transparent",
											border: "none",
											cursor: "pointer",
										}}
									>
										<IconChevronDown
											size={12}
											style={{ transition: "transform 150ms", transform: showExplanation ? "rotate(180deg)" : undefined }}
										/>
										解析
									</Box>
									{showExplanation && (
										<Text
											size="xs"
											c="dimmed"
											lh={1.6}
											mt={6}
											px={12}
											py={8}
											style={{ background: "var(--mantine-color-gray-1)", borderRadius: 8 }}
										>
											{explanations[q.id]}
										</Text>
									)}
								</>
							)}

							{submitError[q.id] && (
								<Group gap={6} mt={8} wrap="nowrap">
									<IconAlertCircle size={11} style={{ color: "var(--mantine-color-red-6)" }} />
									<Text size="10px" c="red.6">{submitError[q.id]}</Text>
								</Group>
							)}
						</Box>
					);
				})}
			</Box>

			{answeredCount === questions.length && questions.length > 0 && (
				<Box px="sm" py={8} style={{ borderTop: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-green-0)", flexShrink: 0 }}>
					<Text size="xs" c="green.7" ta="center">
						<IconCircleCheck size={12} style={{ display: "inline", marginRight: 4 }} />
						全部完成 — 共 {answeredCount} 题
					</Text>
				</Box>
			)}
		</Box>
	);
}
