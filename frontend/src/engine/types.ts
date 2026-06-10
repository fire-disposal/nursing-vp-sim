import type { ComponentType } from "react";

export interface ChatMessage {
  id?: string | number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
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
}

export interface ScoreData {
  total_score?: number;
  detail_scores?: Record<string, number>;
  strengths?: string[];
  weaknesses?: string[];
  summary?: string;
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

export interface SlotProps {
  ctx: PluginContext;
  features: Record<string, boolean>;
  currentPhase: string;
  phaseCount: number;
  advancePhase: () => void;
}

export interface BadgeInfo {
  text: string;
  variant: "default" | "destructive";
}

export interface PluginHooks {
  onInit?: (ctx: PluginContext) => void | (() => void);
  onDestroy?: () => void;
  beforeSend?: (text: string, ctx: PluginContext) => string | Promise<string>;
  afterReceive?: (msg: ChatMessage, ctx: PluginContext) => ChatMessage | null | Promise<ChatMessage | null>;
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
  featureFlag?: string;
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
