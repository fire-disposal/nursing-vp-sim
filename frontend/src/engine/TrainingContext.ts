import { createContext, useContext } from "react";
import type { ChatMessage, MessageBus, PatientData } from "./types";

export interface TrainingRecordDetail {
	exam_results?: Array<{ type: string; value: string; label?: string; unit?: string }>;
	triage_result?: Record<string, unknown>;
	nursing_record_sheet?: Record<string, string>;
	sheet_data?: Record<string, unknown>;
	quiz?: { questions?: Array<Record<string, unknown>> };
	messages?: Array<{ role: string; content: string }>;
	[key: string]: unknown;
}

export interface TrainingContextValue {
	bus: MessageBus;
	recordId: string;
	trainingType: string;
	patient: PatientData;
	messages: ChatMessage[];
	capabilities: Record<string, boolean>;
	recordDetail: TrainingRecordDetail | null;
	ttsAutoPlay: boolean;
	sending: boolean;
	timeLimitMinutes: number;
	remainingSeconds: number | null;
	voiceStatus: { provider: string; latencyMs: number } | null;
	toggleTts: () => void;
	endTraining: () => Promise<void>;
}

const TrainingContext = createContext<TrainingContextValue | null>(null);

export function useTrainingContext(): TrainingContextValue {
	const ctx = useContext(TrainingContext);
	if (!ctx) {
		throw new Error("useTrainingContext must be used within TrainingContext.Provider");
	}
	return ctx;
}

export default TrainingContext;
