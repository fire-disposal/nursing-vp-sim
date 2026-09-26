

export interface ChatMessage {
	id?: string | number;
	role: "student" | "patient" | "system";
	content: string;
	streaming?: boolean;
	streamError?: string;
	timestamp?: string;
	examResult?: { type: string; data: Record<string, unknown> };
}

export interface PatientData {
	name: string;
	age: number;
	gender: "male" | "female";
	caseTitle: string;
	chiefComplaint?: string;
	personality?: string;
	requiredInquiries?: string[];
	examAnchors?: Record<string, unknown>;
}

export type ScorePhase = "loading" | "scoring" | "feedback" | "saving" | "completed" | "failed" | "processing" | null;

export interface ScoringProgress {
	phase: ScorePhase;
	percentage: number;
	message: string;
	thought?: string;
	score_thought?: string;
	feedback_thought?: string;
}

export interface MessageBus {
	on(event: string, handler: (...args: any[]) => void): () => void;
	emit(event: string, ...args: any[]): void;
	off(event: string, handler: (...args: any[]) => void): void;
	listEvents(): string[];
}

export interface BadgeInfo {
	text: string;
	variant: "default" | "destructive";
}

