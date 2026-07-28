import { AlertCircle, CheckCircle2, ChevronDown, HelpCircle, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import { cn } from "@/lib/utils";

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
): string {
	if (!selected) return "border-border bg-muted/30 hover:bg-muted cursor-pointer dark:bg-muted/20 dark:hover:bg-muted/40";
	if (isCorrectAnswer) return "border-emerald-500/40 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-950/50";
	if (selected === optKey && !isCorrectAnswer) return "border-red-500/40 bg-red-50/70 dark:border-red-500/30 dark:bg-red-950/50";
	return "border-border bg-muted/30 opacity-50 dark:bg-muted/20";
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
			<div className="flex items-center justify-center h-32 text-muted-foreground">
				<Loader2 size={18} className="animate-spin mr-2" />
				<span className="text-xs">加载题目…</span>
			</div>
		);
	}

	// ── Error state ──
	if (loadError) {
		return (
			<div className="flex flex-col items-center gap-2 p-6 text-muted-foreground text-center">
				<AlertCircle size={24} className="opacity-40" />
				<span className="text-xs">{loadError}</span>
			</div>
		);
	}

	const questions = quiz?.questions ?? [];

	// ── Empty state ──
	if (questions.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 p-6 text-muted-foreground text-center">
				<HelpCircle size={24} className="opacity-40" />
				<span className="text-xs">该病例未配置引导题目</span>
			</div>
		);
	}

	const answeredCount = Object.keys(answers).length;

	return (
		<div className="flex flex-col h-full bg-background">
			<div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
				<span className="text-xs font-semibold text-foreground">
					{quiz?.title ?? "引导题目"}
				</span>
				<span className="text-[10px] text-muted-foreground tabular-nums">
					{answeredCount}/{questions.length}
				</span>
			</div>

			<div className="flex-1 overflow-y-auto p-3 space-y-4">
				{questions.map((q, qi) => {
					const selected = answers[q.id];
					const isCorrect = correctFlags[q.id] ?? false;
					// Only show correctness after backend confirms (no client-side fallback)
					const hasResult = correctFlags[q.id] !== undefined;
					const showExplanation = expanded[q.id];
					const correctKey = correctAnswers[q.id];

					return (
						<div
							key={q.id}
							className={cn(
								"rounded-xl border p-3 transition-colors",
								hasResult
									? isCorrect
										? "border-emerald-500/30 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-950/30"
										: "border-red-500/30 bg-red-50/50 dark:border-red-500/20 dark:bg-red-950/30"
									: "border-border bg-card",
							)}
						>
							<div className="flex items-start gap-2">
								<span className="text-[10px] font-semibold text-muted-foreground mt-0.5 shrink-0">
									Q{qi + 1}
								</span>
								<p className="text-sm font-medium leading-snug flex-1">
									{q.stem}
								</p>
								{submittingId === q.id ? (
									<Loader2
										size={14}
										className="animate-spin text-muted-foreground shrink-0"
									/>
								) : (
									hasResult && (
										<span className="shrink-0">
											{isCorrect ? (
												<CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
											) : (
												<XCircle size={14} className="text-red-500 dark:text-red-400" />
											)}
										</span>
							))}
							</div>

							<div className="mt-2.5 space-y-1">
								{q.options.map((opt) => {
									const isSelected = selected === opt.key;
									const isAnswer = hasResult && correctKey === opt.key;
									const style = optionStyle(
										hasResult ? undefined : selected,
										opt.key,
										isAnswer,
									);

									return (
										<button
											key={opt.key}
											type="button"
											disabled={!!selected}
											onClick={() => selectOption(q.id, opt.key)}
											className={cn(
												"w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left transition-colors",
												style,
											)}
										>
											<span
												className={cn(
													"shrink-0 size-4 rounded-full border flex items-center justify-center text-[10px] font-semibold",
													isAnswer
														? "border-emerald-500 bg-emerald-500 text-white"
														: isSelected && hasResult && !isCorrect
															? "border-red-500 bg-red-500 text-white"
															: "border-muted-foreground/30 text-muted-foreground",
												)}
											>
												{isAnswer ? (
													<CheckCircle2 size={10} />
												) : isSelected && hasResult && !isCorrect ? (
													<XCircle size={10} />
												) : (
													opt.key
												)}
											</span>
											<span
												className={cn(
													"flex-1",
													isAnswer && "text-emerald-700 font-medium",
													isSelected && hasResult && !isCorrect && "text-red-700 line-through",
												)}
											>
												{opt.text}
											</span>
											{isAnswer && isSelected && !isCorrect && (
												<span className="text-[10px] text-emerald-600 font-medium">正确答案</span>
											)}
										</button>
									);
								})}
							</div>

							{selected && explanations[q.id] && (
								<>
									<button
										onClick={() => toggleExplanation(q.id)}
										className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
									>
										<ChevronDown
											size={12}
											className={cn(
												"transition-transform",
												showExplanation && "rotate-180",
											)}
										/>
										解析
									</button>
									{showExplanation && (
										<p className="mt-1.5 text-xs text-muted-foreground leading-relaxed bg-muted/30 rounded-lg px-3 py-2">
											{explanations[q.id]}
										</p>
									)}
								</>
							)}

							{submitError[q.id] && (
								<div className="mt-2 flex items-center gap-1.5 text-[10px] text-danger">
									<AlertCircle size={11} />
									{submitError[q.id]}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{answeredCount === questions.length && questions.length > 0 && (
				<div className="px-3 py-2 border-t border-border bg-emerald-50/50 shrink-0">
					<p className="text-xs text-emerald-700 text-center">
						<CheckCircle2 size={12} className="inline mr-1" />
						全部完成 — 共 {answeredCount} 题
					</p>
				</div>
			)}
		</div>
	);
}
