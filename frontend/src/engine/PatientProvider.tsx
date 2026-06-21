// frontend/src/engine/PatientProvider.tsx
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { api } from "@/api/axios-instance";
import type { ChatMessage, PatientData } from "./types";

interface PatientContextValue {
	patient: PatientData | null;
	loading: boolean;
	error: string | null;
	features: Record<string, boolean>;
	fromAssignment: boolean;
	initialMessages: ChatMessage[];
	timeLimit: number;
	remainingSeconds: number | null;
}

const PatientContext = createContext<PatientContextValue>({
	patient: null,
	loading: true,
	error: null,
	features: {},
	fromAssignment: false,
	initialMessages: [],
	timeLimit: 20,
	remainingSeconds: null,
});

export function PatientProvider({
	recordId,
	children,
}: {
	recordId: string;
	children: ReactNode;
}) {
	const [patient, setPatient] = useState<PatientData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [features, setFeatures] = useState<Record<string, boolean>>({});
	const [fromAssignment, setFromAssignment] = useState(false);
	const [initialMessages, setInitialMessages] = useState<ChatMessage[]>([]);
	const [timeLimit, setTimeLimit] = useState(20);
	const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
			.get(`/training/records/${recordId}`)
			.then((res) => {
				if (cancelled) return;
				const d = res.data;
				const rawGender = d.patient_gender || d.patient_info?.gender || "male";
			const gender = rawGender === "男" ? "male" : rawGender === "女" ? "female" : rawGender;
			setPatient({
					name: d.patient_name ?? d.patient?.name ?? "患者",
					age: d.patient_age ?? d.patient?.age ?? 0,
					gender,
					caseTitle: d.case_title ?? d.case?.title ?? "",
					chiefComplaint: d.chief_complaint ?? d.case?.chief_complaint ?? "",
					personality: d.personality ?? d.case?.personality ?? "",
					requiredInquiries: d.required_inquiries ?? [],
					examAnchors: d.exam_anchors ?? {},
				});
				setFeatures(d.features ?? {});
				setFromAssignment(d.from_assignment ?? false);
				setTimeLimit(d.time_limit ?? 20);
				setRemainingSeconds(d.remaining_seconds ?? null);
				const msgs = d.messages as
					| Array<{ id: number; role: string; content: string }>
					| undefined;
				if (msgs && msgs.length > 0) {
					setInitialMessages(
						msgs.map((m) => ({
							id: String(m.id),
							role:
								m.role === "student"
									? "student"
									: m.role === "patient"
										? "patient"
										: "system",
							content: m.content,
						})),
					);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					const msg = err.response?.data?.message || err.response?.data?.detail || err.message || "加载患者信息失败";
					setError(msg);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [recordId]);

	const value = useMemo(
		() => ({
			patient,
			loading,
			error,
			features,
			fromAssignment,
			initialMessages,
			timeLimit,
			remainingSeconds,
		}),
		[
			patient,
			loading,
			error,
			features,
			fromAssignment,
			initialMessages,
			timeLimit,
			remainingSeconds,
		],
	);

	return (
		<PatientContext.Provider value={value}>{children}</PatientContext.Provider>
	);
}

export function usePatient() {
	return useContext(PatientContext);
}
