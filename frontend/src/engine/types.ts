

import type { PortraitStates } from "@/utils/avatar";

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
	/** 病例声明的情绪立绘（可选）：表现层按当前情绪选图，未声明即单张立绘。 */
	portraitStates?: PortraitStates | null;
}

export type ScorePhase = "loading" | "scoring" | "feedback" | "saving" | "completed" | "failed" | "processing" | null;

export interface ScoringProgress {
	phase: ScorePhase;
	percentage: number;
	message: string;
	/**
	 * 后端尚未给出可靠进度（true）—— 消费方此时**不得**显示百分比，
	 * 只显示不定态"进行中"（前端不编造进度）。
	 */
	indeterminate?: boolean;
	thought?: string;
	score_thought?: string;
	feedback_thought?: string;
}

export interface MessageBus {
	on(event: string, handler: (...args: any[]) => void): () => void;
	emit(event: string, ...args: any[]): void;
	off(event: string, handler: (...args: any[]) => void): void;
}

export interface BadgeInfo {
	text: string;
	variant: "default" | "destructive";
}

