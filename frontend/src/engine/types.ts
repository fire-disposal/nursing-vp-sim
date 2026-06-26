import type { ComponentType } from "react";

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

export interface ScoreDimension {
	score: number;
	max: number;
	items?: ScoreDimensionItem[];
}
export interface ScoreDimensionItem {
	name: string;
	score: number;
	max: number;
	evidence?: string;
	reason?: string;
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

export interface ScoreData {
	total_score?: number;
	detail_scores?: Record<string, ScoreDimension>;
	strengths?: string[];
	weaknesses?: string[];
	missed_content?: string[];
	suggestions?: string;
}

export interface MessageBus {
	on(event: string, handler: (...args: any[]) => void): () => void;
	emit(event: string, ...args: any[]): void;
	off(event: string, handler: (...args: any[]) => void): void;
	listEvents(): string[];
}

export interface PluginContext {
	recordId: string;
	bus: MessageBus;
	patient: PatientData;
	messages: ChatMessage[];
	loading: boolean;
	tts: {
		isAutoPlay: boolean;
		setAutoPlay: (v: boolean) => void;
	};
	sendMessage: (text: string) => void;
	endTraining: () => Promise<void>;
}

export interface BadgeInfo {
	text: string;
	variant: "default" | "destructive";
}

export interface PluginHooks {
	onInit?: (ctx: PluginContext) => undefined | (() => void);
	onDestroy?: () => void;
	beforeSend?: (text: string, ctx: PluginContext) => string | Promise<string>;
	afterReceive?: (
		msg: ChatMessage,
		ctx: PluginContext,
	) => ChatMessage | null | Promise<ChatMessage | null>;
	onPhaseChange?: (from: string, to: string, ctx: PluginContext) => void;
	onEnd?: (reason: "manual" | "timeout", ctx: PluginContext) => void;
}

export interface PanelTabProps {
	ctx: PluginContext;
	features: Record<string, boolean>;
	isCollapsed: boolean;
}

export interface PanelPlugin {
	id: string;
	meta: { name: string; description?: string };
	tab: {
		icon: ComponentType<{ size?: number }>;
		label: string;
		badge?: (ctx: PluginContext) => BadgeInfo | null;
		priority?: number;
	};
	component: ComponentType<PanelTabProps>;
	hooks?: PluginHooks;
}

// ── Backend Manifest types ──

export interface ManifestPlugin {
	id: string;
	name: string;
	description?: string;
	feature_flag?: string;
	requires: string[];
	ui?: ManifestUI;
}

export interface ManifestUI {
	type: "panel" | "overlay";
	tab?: {
		icon: string;
		label: string;
		priority?: number;
		badge?: string;
	};
	actions?: ManifestAction[];
}

export interface ManifestAction {
	id: string;
	label: string;
	type: string;
	op_type?: string;
}

