import { useEffect, useRef, useState } from "react";
import { api } from "@/api/axios-instance";
import type { MessageBus } from "@/engine/types";

interface QuestionnaireOverlayProps {
	recordId: string;
	bus: MessageBus;
	features: Record<string, boolean>;
}

interface Questionnaire {
	id: number;
	title: string;
	questions: Array<{
		id: number;
		text: string;
		type: string;
		options?: string[];
	}>;
}

export function QuestionnaireOverlay({
	recordId,
	bus,
	features,
}: QuestionnaireOverlayProps) {
	if (!features.questionnaire) return null;
	return <QuestionnaireOverlayInner recordId={recordId} bus={bus} />;
}

function QuestionnaireOverlayInner({
	recordId,
	bus,
}: {
	recordId: string;
	bus: MessageBus;
}) {
	const [phase, setPhase] = useState<"pre" | "post" | null>(null);
	const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(
		null,
	);
	const [answers, setAnswers] = useState<Record<number, string>>({});
	const cancelled = useRef(false);

	useEffect(() => {
		return () => {
			cancelled.current = true;
		};
	}, []);

	useEffect(() => {
		const unsubEnd = bus.on("training:ended", () => setPhase("post"));
		checkPreQuestionnaire();
		return unsubEnd;
	}, []);

	async function checkPreQuestionnaire() {
		try {
			const res = await api.get(`/questionnaires/training/${recordId}/pre`);
			if (cancelled.current) return;
			if (res.data && (res.data as Questionnaire).questions?.length) {
				setQuestionnaire(res.data as Questionnaire);
				setPhase("pre");
			}
		} catch {
			/* no pre-questionnaire */
		}
	}

	useEffect(() => {
		if (phase === "post") {
			(async () => {
				try {
					const res = await api.get(
						`/questionnaires/training/${recordId}/post`,
					);
					if (cancelled.current) return;
					if (res.data && (res.data as Questionnaire).questions?.length) {
						setQuestionnaire(res.data as Questionnaire);
						setAnswers({});
					}
				} catch {
					/* no post-questionnaire */
				}
			})();
		}
	}, [phase]);

	if (!phase || !questionnaire) return null;

	const submit = async () => {
		try {
			await api.post(`/questionnaires/${questionnaire.id}/submit`, {
				record_id: Number(recordId),
				answers,
			});
			if (cancelled.current) return;
			setPhase(null);
			setQuestionnaire(null);
		} catch (e: unknown) {
			console.error("问卷提交失败", e);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-lg">
				<h2 className="mb-4 text-lg font-semibold">{questionnaire.title}</h2>
				<div className="max-h-[60vh] space-y-4 overflow-auto">
					{questionnaire.questions.map((q) => (
						<div key={q.id}>
							<label className="mb-1 block text-sm font-medium">{q.text}</label>
							{q.type === "text" ? (
								<input
									value={answers[q.id] ?? ""}
									onChange={(e) =>
										setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
									}
									className="w-full rounded border px-2 py-1 text-sm"
								/>
							) : (
								<select
									value={answers[q.id] ?? ""}
									onChange={(e) =>
										setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
									}
									className="w-full rounded border px-2 py-1 text-sm"
								>
									<option value="">请选择</option>
									{q.options?.map((o) => (
										<option key={o} value={o}>
											{o}
										</option>
									))}
								</select>
							)}
						</div>
					))}
				</div>
				<div className="mt-4 flex justify-end gap-2">
					{phase === "pre" && (
						<button
							type="button"
							onClick={() => setPhase(null)}
							className="rounded px-3 py-1 text-sm text-muted-foreground"
						>
							跳过
						</button>
					)}
					<button
						type="button"
						onClick={submit}
						className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
					>
						提交
					</button>
				</div>
			</div>
		</div>
	);
}
