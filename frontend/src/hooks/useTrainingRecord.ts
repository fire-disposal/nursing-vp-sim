import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getRecordDetail } from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import type { ChatMessage, PatientData } from "@/engine/types";

export interface TrainingRecordData {
	patient: PatientData;
	trainingType: string;
	features: Record<string, boolean>;
	fromAssignment: boolean;
	initialMessages: ChatMessage[];
	timeLimit: number;
	remainingSeconds: number | null;
}

/**
 * Shared hook — reads from the same cache as RecordDetail page.
 *
 * Uses React Query for caching, auto-retry, and stale-time management.
 * The query key matches queryKeys.training.detail, so if RecordDetail
 * is already open in another tab/cache, this hook will reuse the
 * cached response instead of making a duplicate request.
 */
export function useTrainingRecord(recordId: string) {
	const query = useQuery({
		queryKey: queryKeys.training.detail(recordId),
		queryFn: () => getRecordDetail(recordId).then((r) => r.data),
		enabled: !!recordId,
		staleTime: 2 * 60_000,
		gcTime: 5 * 60_000,
	});

	const record = query.data;

	const data = useMemo<TrainingRecordData | null>(() => {
		if (!record) return null;
		const d = record as {
			patient_name?: string;
			patient_age?: number;
			patient_gender?: string;
			patient_info?: { gender?: string };
			case_title?: string;
			chief_complaint?: string;
			training_type?: string;
			personality?: string;
			required_inquiries?: string[];
			exam_anchors?: Record<string, unknown>;
			features?: Record<string, boolean>;
			from_assignment?: boolean;
			messages?: Array<{ id: number; role: string; content: string }>;
			time_limit?: number;
			remaining_seconds?: number | null;
			case?: {
				name?: string;
				age?: number;
				title?: string;
				chief_complaint?: string;
				personality?: string;
			};
		};

		const rawGender = d.patient_gender || d.patient_info?.gender || "male";
		const gender: "male" | "female" =
			rawGender === "男"
				? "male"
				: rawGender === "女"
					? "female"
					: rawGender === "male"
						? "male"
						: "female";

		const patient: PatientData = {
			name: d.patient_name ?? d.case?.name ?? "患者",
			age: d.patient_age ?? d.case?.age ?? 0,
			gender,
			caseTitle: d.case_title ?? d.case?.title ?? "",
			chiefComplaint: d.chief_complaint ?? d.case?.chief_complaint ?? "",
			personality: d.personality ?? d.case?.personality ?? "",
			requiredInquiries: d.required_inquiries ?? [],
			examAnchors: d.exam_anchors ?? {},
		};

		const msgs = d.messages ?? [];
		const initialMessages: ChatMessage[] = msgs.map((m) => ({
			id: String(m.id),
			role:
				m.role === "student"
					? ("student" as const)
					: m.role === "patient"
						? ("patient" as const)
						: ("system" as const),
			content: m.content,
		}));

		return {
			patient,
			trainingType: d.training_type || "history_taking",
			features: d.features ?? {},
			fromAssignment: d.from_assignment ?? false,
			initialMessages,
			timeLimit: d.time_limit ?? 20,
			remainingSeconds: d.remaining_seconds ?? null,
		};
	}, [record]);

	const error = query.isError
		? (query.error as {
				response?: { data?: { detail?: string } };
				message?: string;
			})?.response?.data?.detail ||
			(query.error as Error)?.message ||
			"加载患者信息失败"
		: null;

	return {
		data,
		loading: query.isLoading || query.isFetching,
		error,
	};
}
