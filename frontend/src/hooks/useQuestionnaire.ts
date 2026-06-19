import { useCallback, useState } from "react";
import { checkQuestionnaire, submitQuestionnaire } from "@/api/questionnaires";
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
			const resp = await checkQuestionnaire({
				case_id: caseId ?? undefined,
				record_id: recordId ?? undefined,
				trigger,
			});
			setCheckResponse(resp.data as CheckResponse);
			setDismissed(false);
			return resp.data as CheckResponse;
		} catch {
			return null;
		} finally {
			setIsLoading(false);
		}
	}, [caseId, recordId, trigger]);

	const submit = useCallback(
		async (answers: { question_id: number; answer_value: string | null }[]) => {
			if (!checkResponse?.template_id) return;
			await submitQuestionnaire({
				template_id: checkResponse.template_id,
				case_id: caseId ?? undefined,
				record_id: recordId ?? undefined,
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
