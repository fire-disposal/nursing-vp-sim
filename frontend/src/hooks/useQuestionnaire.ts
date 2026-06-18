import { api } from "@/api/axios-instance";
import { useCallback, useState } from "react";
import type { CheckResponse } from "@/components/QuestionnaireModal";

interface UseQuestionnaireOptions {
	caseId?: number | null;
	recordId?: number | null;
	trigger: string;
	onComplete?: () => void;
}

interface UseQuestionnaireReturn {
	checkResponse: CheckResponse | null;
	isLoading: boolean;
	shouldShow: boolean;
	check: () => Promise<CheckResponse | null>;
	submit: (
		answers: { question_id: number; answer_value: string | null }[],
	) => Promise<void>;
	dismiss: () => void;
}

export function useQuestionnaire(
	options: UseQuestionnaireOptions,
): UseQuestionnaireReturn {
	const { caseId, recordId, trigger, onComplete } = options;
	const [checkResponse, setCheckResponse] = useState<CheckResponse | null>(
		null,
	);
	const [isLoading, setIsLoading] = useState(false);
	const [dismissed, setDismissed] = useState(false);

	const check = useCallback(async (): Promise<CheckResponse | null> => {
		if (!caseId && !recordId) return null;
		setIsLoading(true);
		try {
			const params = new URLSearchParams();
			if (caseId) params.set("case_id", String(caseId));
			if (recordId) params.set("record_id", String(recordId));
			params.set("trigger", trigger);

			const resp = await api.get<CheckResponse>(
				`/questionnaires/check?${params}`,
			);
			setCheckResponse(resp.data);
			setDismissed(false);
			return resp.data;
		} catch {
			return null;
		} finally {
			setIsLoading(false);
		}
	}, [caseId, recordId, trigger]);

	const submit = useCallback(
		async (answers: { question_id: number; answer_value: string | null }[]) => {
			if (!checkResponse?.template_id) return;
			await api.post("/questionnaires/responses", {
				template_id: checkResponse.template_id,
				case_id: caseId,
				record_id: recordId,
				answers,
			});
			onComplete?.();
		},
		[checkResponse?.template_id, caseId, recordId, onComplete],
	);

	const dismiss = useCallback(() => {
		setDismissed(true);
	}, []);

	const shouldShow = !!(checkResponse?.has_pending && !dismissed);

	return { checkResponse, isLoading, shouldShow, check, submit, dismiss };
}
