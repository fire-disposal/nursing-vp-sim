import { Activity, ArrowLeft, Brain, Bug, ClipboardList, Heart, MessageCircle, RefreshCw, Send, Stethoscope, Timer } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { endTraining, getCases, getTrainingState, startTraining, triggerInitiative, updateTrainingFeatures } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import ChatBubble from "@/components/ChatBubble";
import OperationPanel from "@/components/training/OperationPanel";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import { useChatStream } from "@/hooks/useChatStream";
import { useTypingFreeze } from "@/hooks/useTypingFreeze";
import { cn } from "@/lib/utils";
import { getNurseAvatar, getPatientAvatar } from "@/utils/avatar";

type CaseBrief = components["schemas"]["CaseBrief"];

interface TrainingState {
  emotion: { score: number; state: string; note: string };
  personality: Record<string, string>;
  deep_background_keys: string[];
  exam_anchors: Record<string, unknown>;
  config: { id: string; mode: string; features: Record<string, boolean> };
  initiative: { elapsed_seconds: number; threshold_seconds: number; percent: number };
}

const PERSONALITY_LABELS: Record<string, Record<string, string>> = {
  health_literacy: { low: "低", normal: "中等", high: "高" },
  verbosity: { terse: "寡言", normal: "正常", verbose: "絮叨" },
  anxiety_trait: { calm: "安宁", normal: "平常", anxious: "焦虑" },
  patience: { low: "急躁", normal: "正常", high: "耐心" },
};

const PERSONALITY_BAR_COLORS: Record<string, string> = {
  health_literacy: "bg-blue-500",
  verbosity: "bg-purple-500",
  anxiety_trait: "bg-amber-500",
  patience: "bg-emerald-500",
};

const PERSONALITY_ICONS: Record<string, typeof Brain> = {
  health_literacy: Brain,
  verbosity: MessageCircle,
  anxiety_trait: Heart,
  patience: Timer,
};

const DIM_LABEL: Record<string, string> = {
  health_literacy: "健康素养",
  verbosity: "健谈度",
  anxiety_trait: "焦虑倾向",
  patience: "耐心度",
};

const ANCHOR_LABEL: Record<string, string> = {
  vital_signs: "生命体征",
  auscultation: "听诊",
  skin: "皮肤",
  pain_score: "疼痛评分",
};

function personalityBarValue(val: string): number {
  const scale: Record<string, number> = { low: 1, terse: 1, calm: 1, normal: 3, high: 5, verbose: 5, anxious: 5 };
  return scale[val] ?? 3;
}

function statusColor(score: number) {
  if (score >= 1) return "bg-green-100 text-green-700";
  if (score <= -1) return "bg-red-100 text-red-700";
  return "bg-muted text-muted-foreground";
}

interface SectionProps {
  icon: typeof Bug;
  iconColor: string;
  title: string;
  action?: { label: string; onClick: () => void };
  loading?: boolean;
  children: React.ReactNode;
}

function Section({ icon: Icon, iconColor, title, action, loading, children }: SectionProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
          {title}
        </h4>
        {action && (
          <button onClick={action.onClick} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
            <RefreshCw className="h-3 w-3" />
            {action.label}
          </button>
        )}
      </div>
      {loading ? <div className="h-12 rounded bg-muted animate-pulse" /> : children}
    </div>
  );
}

interface BarProps {
  value: number;
  max?: number;
  color?: string;
}

function Bar({ value, max = 100, color }: BarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full transition-all duration-500", color || "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function AdminDebugPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<CaseBrief[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [recordId, setRecordId] = useState<number | null>(null);
  const { messages, setMessages, send, loading, abortRef } = useChatStream(recordId);
  const { typingFrozen, markTyping } = useTypingFreeze();
  const [input, setInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [state, setState] = useState<TrainingState | null>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [msgTimestamps, setMsgTimestamps] = useState<number[]>([]);
  const initiativeFiredRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getCases({ limit: 50 }).then((r) => setCases(r.data.items || []));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  useEffect(() => {
    if (!recordId) return;
    pollRef.current = setInterval(async () => {
      if (typingFrozen || loading) return;
      try {
        const r = await getTrainingState(recordId);
        setState(r.data as unknown as TrainingState);
        if (r.data.initiative?.percent >= 100 && !initiativeFiredRef.current) {
          initiativeFiredRef.current = true;
          const trigger = await triggerInitiative(recordId);
          if (trigger.data.triggered && trigger.data.message) {
            setMessages((prev) => [...prev, { id: Date.now(), role: "patient", content: trigger.data.message as string }]);
            setMsgTimestamps((prev) => [...prev, Date.now()]);
          }
          setTimeout(() => {
            initiativeFiredRef.current = false;
          }, 3000);
        }
      } catch {
        /* poll ignore */
      }
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [recordId, loading, typingFrozen, setMessages]);

  const refreshState = useCallback(async () => {
    if (!recordId) return;
    try {
      const r = await getTrainingState(recordId);
      setState(r.data as unknown as TrainingState);
    } catch {
      /* ignore */
    }
  }, [recordId]);

  const handleStart = async () => {
    if (!selectedCaseId) return;
    setStarting(true);
    try {
      const r = await startTraining(selectedCaseId, "free-exploration");
      setRecordId(r.data.record_id);
      setMessages([{ id: Date.now(), role: "patient", content: r.data.greeting }]);
      setMsgTimestamps([Date.now()]);
      await refreshState();
    } finally {
      setStarting(false);
    }
  };

  const handleSend = async (retryContent?: string) => {
    const content = (retryContent ?? input).trim();
    if (!content || !recordId || loading) return;
    setInput("");
    setMsgTimestamps((prev) => [...prev, Date.now()]);
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    await send(content);
  };

  const handleEnd = async (navigateAfter = true) => {
    if (!recordId) return;
    setEnding(true);
    try {
      await endTraining(recordId);
    } finally {
      setEnding(false);
      setRecordId(null);
      setMessages([]);
      setState(null);
      if (navigateAfter) navigate("/home");
    }
  };

  const patientMsgs = msgTimestamps.filter((_, i) => i % 2 === 1);
  const lastResponseTime = patientMsgs.length >= 2 ? ((patientMsgs[patientMsgs.length - 1] - patientMsgs[patientMsgs.length - 2]) / 1000).toFixed(1) : null;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputFocus = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 300);
  }, []);

  return (
    <>
      <PageHeader title="调试工坊" subtitle="情绪引擎 · 查体操作 · Character Card" icon={Bug} />

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col rounded-xl border border-border bg-card" style={{ height: "calc(100vh - 180px)" }}>
          {!recordId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
              <Bug className="h-12 w-12 text-muted-foreground/30" />
              <h3 className="text-lg font-semibold">选择病例开始调试</h3>
              <div className="w-full max-w-sm space-y-3">
                <select
                  value={selectedCaseId ?? ""}
                  onChange={(e) => setSelectedCaseId(Number(e.target.value) || null)}
                  className="w-full h-11 rounded-lg border border-border bg-muted px-3 text-sm"
                >
                  <option value="">选择病例...</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.patient_summary ? `· ${((c.patient_summary as Record<string, unknown>).name as string) || ""}` : `(★${c.difficulty})`}
                    </option>
                  ))}
                </select>
                <Button onClick={handleStart} disabled={!selectedCaseId || starting || loading} className="w-full">
                  {starting ? "启动中..." : "开始调试"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      handleEnd();
                      navigate("/cases");
                    }}
                    className="size-10 flex items-center justify-center rounded-md hover:bg-muted"
                    title="返回"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <select
                    value={selectedCaseId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      if (id) {
                        setSelectedCaseId(id);
                        handleEnd();
                      }
                    }}
                    className="text-sm font-medium bg-transparent border-0 cursor-pointer hover:bg-muted rounded px-1 py-0.5 max-w-[140px] truncate"
                  >
                    {cases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">DEBUG</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => navigate("/history")}
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-muted flex items-center gap-1"
                  >
                    <ClipboardList size={12} />
                    历史
                  </button>
                  <button
                    onClick={() => setShowDebug(!showDebug)}
                    className={cn("text-xs px-2 py-1 rounded border", showDebug ? "border-primary bg-primary/10 text-primary" : "border-border")}
                  >
                    {showDebug ? "面板" : "面板"}
                  </button>
                  <button onClick={() => handleEnd()} disabled={ending} className="text-xs px-2 py-1 rounded border border-destructive/50 text-destructive">
                    {ending ? "结束中..." : "结束"}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg, i) => (
                  <ChatBubble key={msg.id ?? i} message={msg} patientAvatar={getPatientAvatar()} nurseAvatar={getNurseAvatar()} />
                ))}
                <div ref={messagesEndRef} />
              </div>

              <OperationPanel onOperation={(cmd) => handleSend(cmd)} results={[]} disabled={loading || ending} />

              <div className="flex items-center gap-2 px-4 py-2 border-t border-border shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    markTyping();
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={handleInputFocus}
                  placeholder="输入消息..."
                  disabled={loading || ending}
                  enterKeyHint="send"
                  autoCapitalize="off"
                  autoCorrect="off"
                  inputMode="text"
                  className="flex-1 h-11 px-4 rounded-full border border-border bg-muted text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={loading || ending || !input.trim()}
                  className="size-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 disabled:opacity-50 active:scale-95 transition-transform"
                >
                  <Send size={17} />
                </button>
              </div>
            </>
          )}
        </div>

        {showDebug && recordId && (
          <div className="space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 180px)" }}>
            <Section icon={Timer} iconColor="text-amber-500" title="患者主动追问" action={{ label: "刷新", onClick: refreshState }} loading={!state}>
              {state?.initiative && (
                <>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">静默</span>
                    <span
                      className={cn(
                        "font-mono",
                        state.initiative.percent >= 80 ? "text-red-500" : state.initiative.percent >= 50 ? "text-amber-500" : "text-muted-foreground",
                      )}
                    >
                      {state.initiative.elapsed_seconds}s / {state.initiative.threshold_seconds}s
                    </span>
                  </div>
                  <Bar
                    value={state.initiative.percent}
                    color={state.initiative.percent >= 80 ? "bg-red-500" : state.initiative.percent >= 50 ? "bg-amber-400" : "bg-blue-400"}
                  />
                </>
              )}
              {state && !state.initiative && <p className="text-[11px] text-muted-foreground">等待消息...</p>}
            </Section>

            <Section icon={Heart} iconColor="text-rose-500" title="情绪状态" action={{ label: "刷新", onClick: refreshState }} loading={!state}>
              {state && (
                <>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded", statusColor(state.emotion.score))}>
                      {state.emotion.state} ({state.emotion.score > 0 ? `+${state.emotion.score}` : state.emotion.score})
                    </span>
                  </div>
                  <Bar
                    value={((state.emotion.score + 2) / 4) * 100}
                    color={state.emotion.score >= 1 ? "bg-green-500" : state.emotion.score <= -1 ? "bg-red-500" : "bg-amber-400"}
                  />
                  <p className="text-[11px] text-muted-foreground">{state.emotion.note}</p>
                </>
              )}
            </Section>

            <Section icon={Brain} iconColor="text-purple-500" title="患者人格" loading={false}>
              {state?.personality && Object.keys(state.personality).length > 0 ? (
                <div className="space-y-1.5">
                  {Object.entries(state.personality).map(([dim, val]) => {
                    const Icon = PERSONALITY_ICONS[dim] || Brain;
                    const label = PERSONALITY_LABELS[dim]?.[val as string] ?? String(val);
                    return (
                      <div key={dim} className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-1">
                            <Icon className="h-3 w-3 text-muted-foreground" />
                            {DIM_LABEL[dim] || dim}
                          </span>
                          <span className="text-muted-foreground">{label}</span>
                        </div>
                        <Bar value={(personalityBarValue(val as string) / 5) * 100} color={PERSONALITY_BAR_COLORS[dim]} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">未配置</p>
              )}
            </Section>

            <Section icon={Activity} iconColor="text-blue-500" title="对话统计" loading={false}>
              <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                {[
                  { l: "总消息", v: messages.length },
                  { l: "回复", v: patientMsgs.length },
                  { l: "间隔", v: lastResponseTime ? `${lastResponseTime}s` : "—" },
                  { l: "模式", v: state?.config.mode || "—" },
                ].map(({ l, v }) => (
                  <div key={l} className="bg-muted/50 rounded p-1.5">
                    <div className="text-muted-foreground">{l}</div>
                    <div className="font-semibold">{v}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={Stethoscope} iconColor="text-emerald-500" title="体征锚点" loading={false}>
              {state?.exam_anchors && Object.keys(state.exam_anchors).length > 0 ? (
                <div className="space-y-1 text-[11px]">
                  {Object.entries(state.exam_anchors).map(([k, v]) => (
                    <div key={k} className="bg-muted/50 rounded p-2">
                      <div className="font-medium text-muted-foreground mb-0.5">{ANCHOR_LABEL[k] || k}</div>
                      {typeof v === "string" ? (
                        <span className="font-mono">{v}</span>
                      ) : (
                        <div className="space-y-0.5">
                          {Object.entries(v as Record<string, unknown>).map(([sk, sv]) => (
                            <div key={sk} className="flex justify-between">
                              <span className="text-muted-foreground">{sk}</span>
                              <span className="font-mono">{String(sv)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">无锚点</p>
              )}
            </Section>

            <Section icon={Bug} iconColor="text-muted-foreground" title="功能开关" loading={false}>
              {state?.config?.features && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(state.config.features).map(([k, v]) => (
                    <button
                      key={k}
                      onClick={async () => {
                        if (!recordId) return;
                        try {
                          await updateTrainingFeatures(recordId, { [k]: !v });
                          setState((prev) => (prev ? { ...prev, config: { ...prev.config, features: { ...prev.config.features, [k]: !v } } } : null));
                        } catch {
                          /* ignore */
                        }
                      }}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] border transition-colors hover:opacity-80",
                        v ? "bg-green-100 text-green-700 border-green-300" : "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {k}: {v ? "ON" : "OFF"}
                    </button>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </>
  );
}
