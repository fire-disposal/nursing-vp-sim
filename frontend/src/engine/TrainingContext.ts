import { createContext, useContext } from "react";
import type { MessageBus, PatientData } from "./types";

export interface TrainingContextValue {
	bus: MessageBus;
	recordId: string;
	trainingType: string;
	patient: PatientData;
	features: Record<string, boolean>;
	ttsAutoPlay: boolean;
	sending: boolean;
	featuresLocked: boolean;
	fromAssignment: boolean;
	timeLimitMinutes: number;
	remainingSeconds: number | null;
	voiceStatus: { provider: string; latencyMs: number } | null;
	toggleFeature: (key: string, enabled: boolean) => void;
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
