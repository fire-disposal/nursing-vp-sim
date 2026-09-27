import { useCallback, useRef, useState } from "react";
import type { components } from "@/api/api-types.gen";
import { checkQuestionnaire, submitQuestionnaire } from "@/api/questionnaires";
import type { CheckResponse } from "@/components/QuestionnaireModal";

interface UseQuestionnaireOptions {
	caseId?: number | null;
	recordId?: number | null;
	trigger: components["schemas"]["QuestionnaireTrigger"];
	onComplete?: () => void;
}

/**
 * 问卷区域的可见状态（页面只按它渲染，不在页面里另行推导）：
 * - `idle`：还没检查过；
 * - `none`：服务端明确无待答问卷 —— 正确行为是**什么都不显示**；
 * - `ready`：有待答且题目已就绪 —— 展示弹窗；
 * - `template_unavailable`：服务端说有待答、但题目拿不到 —— 必须可见且可重试，
 *   否则研究里会被误判成「学生跳过了问卷」；
 * - `check_failed`：check 请求本身失败 —— 可见但不阻塞学习。
 */
export type QuestionnaireStatus =
	| "idle"
	| "none"
	| "ready"
	| "template_unavailable"
	| "check_failed";

interface UseQuestionnaireReturn {
	checkResponse: CheckResponse | null;
	status: QuestionnaireStatus;
	isLoading: boolean;
	isSubmitting: boolean;
	hasChecked: boolean;
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
	const [checkFailed, setCheckFailed] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [hasChecked, setHasChecked] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const submittingRef = useRef(false);

	const check = useCallback(async (): Promise<CheckResponse | null> => {
		if (!caseId && !recordId) return null;
		setHasChecked(false);
		setIsLoading(true);
		try {
			const resp = await checkQuestionnaire({
				case_id: caseId ?? undefined,
				record_id: recordId ?? undefined,
				trigger,
			});
			setCheckResponse(resp.data as CheckResponse);
			setCheckFailed(false);
			setDismissed(false);
			return resp.data as CheckResponse;
		} catch {
			// 不静默：check 失败必须让调用方看见（status = check_failed）并可重试；
			// 但保留上一次成功结果，避免把已经打开、题目已就绪的弹窗拆掉。
			setCheckFailed(true);
			return null;
		} finally {
			setHasChecked(true);
			setIsLoading(false);
		}
	}, [caseId, recordId, trigger]);

	const submit = useCallback(
		async (answers: { question_id: number; answer_value: string | null }[]) => {
			const templateId = checkResponse?.template_id;
			// 模板缺失时**不能**静默返回：调用方（弹窗）必须显示出失败并保持打开
			if (!templateId) throw new Error("问卷题目未加载，暂时无法提交");
			// 防双击重复提交
			if (submittingRef.current) return;
			submittingRef.current = true;
			setIsSubmitting(true);
			try {
				await submitQuestionnaire({
					template_id: templateId,
					case_id: caseId ?? undefined,
					record_id: recordId ?? undefined,
					answers,
				});
				onComplete?.();
			} finally {
				submittingRef.current = false;
				setIsSubmitting(false);
			}
		},
		[checkResponse?.template_id, caseId, recordId, onComplete],
	);

	const dismiss = useCallback(() => {
		setDismissed(true);
	}, []);

	// 「有待答」由服务端 has_pending 决定；页面不再自行判断可用性/是否需要填答
	const hasPending = !!(checkResponse?.has_pending && !dismissed);
	const shouldShow = hasPending;
	const status: QuestionnaireStatus = hasPending
		? checkResponse?.template
			? "ready"
			: "template_unavailable"
		: checkFailed
			? "check_failed"
			: hasChecked
				? "none"
				: "idle";

	return {
		checkResponse,
		status,
		isLoading,
		isSubmitting,
		hasChecked,
		shouldShow,
		check,
		submit,
		dismiss,
	};
}
