import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	getTrainingQuestionnaire,
	submitTrainingQuestionnaire,
} from "@/api/questionnaires";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
		return unsubEnd;
	}, []);

	const { data: preQuestionnaire } = useQuery({
		queryKey: ["questionnaire", recordId, "pre"],
		queryFn: async () => {
			const res = await getTrainingQuestionnaire(recordId, "pre");
			return res.data as Questionnaire | null;
		},
		enabled: true,
		staleTime: Infinity,
	});

	useEffect(() => {
		if (preQuestionnaire?.questions?.length && !cancelled.current) {
			setQuestionnaire(preQuestionnaire);
			setPhase("pre");
		}
	}, [preQuestionnaire]);

	const { data: postQuestionnaire } = useQuery({
		queryKey: ["questionnaire", recordId, "post"],
		queryFn: async () => {
			const res = await getTrainingQuestionnaire(recordId, "post");
			return res.data as Questionnaire | null;
		},
		enabled: phase === "post",
		staleTime: Infinity,
	});

	useEffect(() => {
		if (postQuestionnaire?.questions?.length && !cancelled.current) {
			setQuestionnaire(postQuestionnaire);
			setAnswers({});
		}
	}, [postQuestionnaire]);

	const submit = useCallback(async () => {
		if (!questionnaire) return;
		try {
			await submitTrainingQuestionnaire(questionnaire.id, {
				record_id: Number(recordId),
				answers,
			});
			if (cancelled.current) return;
			setPhase(null);
			setQuestionnaire(null);
		} catch (e: unknown) {
			console.error("问卷提交失败", e);
		}
	}, [questionnaire, recordId, answers]);

	if (!phase || !questionnaire) return null;

	return (
		<Dialog
			open
			onOpenChange={(o) => {
				if (!o) setPhase(null);
			}}
		>
			<DialogContent maxWidth={512}>
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
			</DialogContent>
		</Dialog>
	);
}
