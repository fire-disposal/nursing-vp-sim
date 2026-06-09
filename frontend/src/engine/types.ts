import type { ComponentType } from "react";

// ── TTS 服务接口（由 engine/tts/TTSManager 实现）──
export interface TTSService {
  readonly speaking: boolean;
  readonly isAutoPlay: boolean;
  setAutoPlay(on: boolean): void;
  speak(text: string): Promise<void>;
  stop(): void;
}

// ── 消息 / 患者 / 评分（复用现有类型） ──
export interface ChatMessage {
  id?: string | number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
  timestamp?: string;
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

// ── 槽位名称 ──
export type SlotName = "header" | "sidebar" | "content" | "panel" | "overlay" | "footer" | "input-toolbar" | "sidebar-tray";

// ── 槽位渲染定义 ──
export interface SlotDefinition {
  render: "inline" | "drawer" | "sheet" | "modal";
  priority?: number;
}

// ── 布局定义 ──
export interface SlotGrid {
  areas: string[][];
  slots: Partial<Record<SlotName, SlotDefinition>>;
}

export interface LayoutDef {
  breakpoints: {
    desktop: SlotGrid;
    tablet?: SlotGrid;
    mobile: SlotGrid;
  };
  sidebarBehavior: "fixed" | "collapsible" | "drawer";
  panelBehavior: "inline" | "drawer" | "sheet";
}

// ── 生命周期钩子 ──
export interface LifecycleHooks {
  onInit?: (ctx: PluginContext) => undefined | (() => void);
  beforeSend?: (message: string) => string;
  afterReceive?: (message: ChatMessage) => void;
  onPhaseChange?: (from: string, to: string) => void;
  onEnd?: (reason: "manual" | "timeout" | "admin") => void;
  onScoreReady?: (score: ScoreData) => void;
  onDestroy?: () => void;
}

// ── 轮询配置 ──
export interface PollConfig {
  endpoint: string;
  interval: number;
}

// ── MessageBus 接口 ──
export interface MessageBus {
  on(event: string, handler: (...args: any[]) => void): () => void;
  emit(event: string, ...args: any[]): void;
  off(event: string, handler: (...args: any[]) => void): void;
  listEvents(): string[];
}

// ── 插件上下文 ──
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

// ── 插件运行时状态 ──
export type PluginStatus = "active" | "inactive" | "error" | "waiting";

export interface PluginRuntime {
  status: PluginStatus;
  activatedAt?: number;
  hookCalls: Record<string, number>;
  lastError?: string;
}

// ── 插件元数据 ──
export interface PluginMeta {
  description: string;
  icon?: string;
  author?: string;
  version?: string;
  tags?: string[];
  source?: string;
}

// ── 插件定义 ──
export interface TrainingPlugin {
  id: string;
  name: string;
  featureFlag?: string;
  requires?: string[];
  slots?: Partial<Record<SlotName, ComponentType<SlotProps>>>;
  hooks?: Partial<LifecycleHooks>;
  pollConfig?: PollConfig;
  meta: PluginMeta;
  runtime?: PluginRuntime;
}

// ── 传给 slot 组件的 props ──
export interface SlotProps {
  ctx: PluginContext;
  features: Record<string, boolean>;
  currentPhase: string;
  phaseCount: number;
  advancePhase: () => void;
}
