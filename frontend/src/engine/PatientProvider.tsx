import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
} from "react";
import { useTrainingRecord } from "@/hooks/useTrainingRecord";
import type { ChatMessage, PatientData } from "./types";

interface PatientContextValue {
	patient: PatientData | null;
	trainingType: string;
	loading: boolean;
	error: string | null;
	capabilities: Record<string, boolean>;
	fromAssignment: boolean;
	initialMessages: ChatMessage[];
	timeLimit: number;
	remainingSeconds: number | null;
}

const PatientContext = createContext<PatientContextValue>({
	patient: null,
	trainingType: "history_taking",
	loading: true,
	error: null,
	capabilities: {},
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
	const { data, loading, error } = useTrainingRecord(recordId);

	const value = useMemo(
		() => ({
			patient: data?.patient ?? null,
			trainingType: data?.trainingType ?? "history_taking",
			loading,
			error,
			capabilities: data?.features ?? {},
			fromAssignment: data?.fromAssignment ?? false,
			initialMessages: data?.initialMessages ?? [],
			timeLimit: data?.timeLimit ?? 20,
			remainingSeconds: data?.remainingSeconds ?? null,
		}),
		[data, loading, error],
	);

	return (
		<PatientContext.Provider value={value}>{children}</PatientContext.Provider>
	);
}

export function usePatient() {
	return useContext(PatientContext);
}
