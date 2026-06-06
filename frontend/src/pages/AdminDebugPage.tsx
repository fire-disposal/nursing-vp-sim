import { Activity, ArrowLeft, Brain, Bug, Heart, Info, MessageCircle, RefreshCw, Send, Stethoscope, Timer } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { endTraining, getCases, getTrainingState, sendMessageStream, startTraining, triggerInitiative } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Layout from "@/components/Layout";
import OperationPanel from "@/components/OperationPanel";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import { getNurseAvatar, getPatientAvatar } from "@/utils/avatar";

type CaseBrief = components["schemas"]["CaseBrief"];

// Use flexible runtime type for debug panel display
interface TrainingState {
  emotion: { score: number; state: string; note: string };
  personality: Record<string, string>;
  deep_background_keys: string[];
  exam_anchors: Record<string, unknown>;
  config: { id: string; mode: string; features: Record<string, boolean> };
  initiative: { elapsed_seconds: number; threshold_seconds: number; percent: number };
}

interface ChatMessage {
  id?: number;
  role: string;
  content: string;
  streaming?: boolean;
}

const PERSONALITY_LABELS: Record<string, Record<string, string>> = {
  health_literacy: { low: "低素养", normal: "中等", high: "高素养" },
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

function personalityBarValue(val: string): number {
  const scale: Record<string, number> = {
    low: 1,
    terse: 1,
    calm: 1,
    normal: 3,
    high: 5,
    verbose: 5,
    anxious: 5,
  };
  return scale[val] ?? 3;
}

export default function AdminDebugPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<CaseBrief[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [recordId, setRecordId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [state, setState] = useState<TrainingState | null>(null);
  const [opResults, setOpResults] = useState<OperationResult[]>([]);
  const [showDebug, setShowDebug] = useState(true);
  const [msgTimestamps, setMsgTimestamps] = useState<number[]>([]);
  const [initiativeFired, setInitiativeFired] = useState(false);
  const [typingFrozen, setTypingFrozen] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getCases({ limit: 50 }).then((r) => setCases(r.data.items || []));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!recordId || ending) return;
    pollRef.current = setInterval(async () => {
      if (typingFrozen || loading) return;
      try {
        const r = await getTrainingState(recordId);
        const s = r.data;
        setState(s as unknown as TrainingState);
        if (s.initiative?.percent >= 100 && !initiativeFired) {
          setInitiativeFired(true);
          const trigger = await triggerInitiative(recordId);
          if (trigger.data.triggered && trigger.data.message) {
            setMessages((prev) => [...prev, { role: "patient", content: trigger.data.message as string }]);
            setMsgTimestamps((prev) => [...prev, Date.now()]);
          }
          setTimeout(() => setInitiativeFired(false), 2000);
        }
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [recordId, ending, initiativeFired]);

  const refreshState = async () => {
    if (!recordId) return;
    try {
      const r = await getTrainingState(recordId);
      setState(r.data as unknown as TrainingState);
    } catch {
      /* ignore */
    }
  };

  const handleStart = async () => {
    if (!selectedCaseId) return;
    setLoading(true);
    try {
      const r = await startTraining(selectedCaseId, "free-exploration");
      setRecordId(r.data.record_id);
      setMessages([{ role: "patient", content: r.data.greeting }]);
      setMsgTimestamps([Date.now()]);
      await refreshState();
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (retryContent?: string) => {
    const content = (retryContent ?? input).trim();
    if (!content || !recordId || loading) return;
    setInput("");
    setLoading(true);

    const studentMsg: ChatMessage = { role: "student", content };
    setMessages((prev) => [...prev, studentMsg]);
    setMsgTimestamps((prev) => [...prev, Date.now()]);

    if (content.startsWith("/")) {
      setMessages((prev) => [...prev, { role: "system", content: `执行操作: ${content}\n（等待系统返回数据...）` }]);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const patientPlaceholder: ChatMessage = { role: "patient", content: "", streaming: true };
    setMessages((prev) => [...prev, patientPlaceholder]);

    try {
      await sendMessageStream(
        recordId,
        content,
        (chunk: string) => {
          setMessages((prev) => {
            const next = [...prev];
            for (let idx = next.length - 1; idx >= 0; idx--) {
              if (next[idx]?.streaming) {
                next[idx] = { ...next[idx], content: next[idx].content + chunk };
                break;
              }
            }
            return next;
          });
        },
        () => {
          setMessages((prev) => {
            const next = [...prev];
            for (let idx = next.length - 1; idx >= 0; idx--) {
              if (next[idx]?.streaming) {
                next[idx] = { ...next[idx], streaming: false };
                break;
              }
            }
            return next;
          });
          setMsgTimestamps((prev) => [...prev, Date.now()]);
          setLoading(false);
          refreshState();
        },
        (errMsg: string) => {
          setMessages((prev) => prev.filter((m) => !m.streaming));
          setLoading(false);
        },
        undefined,
        (sysMsg: string) => {
          setMessages((prev) => [...prev, { role: "system", content: sysMsg }]);
        },
        controller.signal,
      );
    } catch {
      setMessages((prev) => prev.filter((m) => !m.streaming && m.content !== content));
      setLoading(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleEnd = async () => {
    if (!recordId) return;
    setEnding(true);
    try {
      await endTraining(recordId);
    } finally {
      setEnding(false);
      navigate("/home");
    }
  };

  const caseData = cases.find((c) => c.id === selectedCaseId);
  const patientMsgs = msgTimestamps.filter((_, i) => i % 2 === 1);
  const lastResponseTime = patientMsgs.length >= 2 ? ((patientMsgs[patientMsgs.length - 1] - patientMsgs[patientMsgs.length - 2]) / 1000).toFixed(1) : null;

  return (
    <Layout>
      <PageHeader title="调试工坊" subtitle="试点新交互流程：情绪引擎 + 查体操作 + Character Card" icon={Bug} />

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
                  className="w-full h-10 rounded-lg border border-border bg-muted px-3 text-sm"
                >
                  <option value="">选择病例...</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (★{c.difficulty}) {c.patient_summary ? `— ${((c.patient_summary as Record<string, unknown>).name as string) || ""}` : ""}
                    </option>
                  ))}
                </select>
                <Button onClick={handleStart} disabled={!selectedCaseId || loading} className="w-full">
                  {loading ? "启动中..." : "开始调试 (自由探索模式)"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <button onClick={() => navigate("/home")} className="p-1.5 rounded-md hover:bg-muted">
                    <ArrowLeft size={16} />
                  </button>
                  <span className="text-sm font-medium">{caseData?.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">DEBUG</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowDebug(!showDebug)}
                    className={cn("text-xs px-2 py-1 rounded border", showDebug ? "border-primary bg-primary/10 text-primary" : "border-border")}
                  >
                    {showDebug ? "隐藏调试" : "显示调试"}
                  </button>
                  <button onClick={handleEnd} disabled={ending} className="text-xs px-2 py-1 rounded border border-destructive/50 text-destructive">
                    {ending ? "结束中..." : "结束"}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg, i) =>
                  msg.role === "system" ? (
                    <div key={i} className="flex justify-center">
                      <div className="flex items-start gap-2 max-w-[85%] rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
                        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                        <div className="whitespace-pre-wrap leading-relaxed text-blue-800">{msg.content}</div>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className={cn("flex gap-2", msg.role === "student" ? "justify-end" : "justify-start")}>
                      {msg.role === "patient" && <img className="w-7 h-7 rounded-full shrink-0 bg-muted" src={getPatientAvatar()} alt="" />}
                      <div
                        className={cn(
                          "max-w-[75%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                          msg.role === "student" ? "bg-primary text-primary-foreground" : "bg-muted",
                          msg.streaming && "after:content-['|'] after:animate-pulse",
                        )}
                      >
                        {msg.content || (msg.streaming ? "" : "")}
                      </div>
                      {msg.role === "student" && <img className="w-7 h-7 rounded-full shrink-0 bg-muted" src={getNurseAvatar()} alt="" />}
                    </div>
                  ),
                )}
                <div ref={messagesEndRef} />
              </div>

              <OperationPanel onOperation={(cmd) => handleSend(cmd)} results={opResults} disabled={loading || ending} />

              <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setTypingFrozen(true);
                    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                    typingTimerRef.current = setTimeout(() => setTypingFrozen(false), 2000);
                  }}
                  onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder="输入消息测试新交互流程..."
                  disabled={loading || ending}
                  className="flex-1 h-10 px-4 rounded-full border border-border bg-muted text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={loading || ending || !input.trim()}
                  className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 disabled:opacity-50"
                >
                  <Send size={17} />
                </button>
              </div>
            </>
          )}
        </div>

        {showDebug && recordId && (
          <div className="space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 180px)" }}>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Timer className="h-4 w-4 text-amber-500" />
                患者主动追问
              </h4>
              {state?.initiative ? (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">静默计时</span>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        state.initiative.percent >= 80 ? "text-red-500" : state.initiative.percent >= 50 ? "text-amber-500" : "text-muted-foreground",
                      )}
                    >
                      {state.initiative.elapsed_seconds}s / {state.initiative.threshold_seconds}s
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        state.initiative.percent >= 80 ? "bg-red-500" : state.initiative.percent >= 50 ? "bg-amber-400" : "bg-blue-400",
                      )}
                      style={{ width: `${state.initiative.percent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    阈值受性格(耐心度/焦虑度)和当前情绪影响。
                    <br />
                    焦虑患者阈值更低，耐心患者阈值更高。
                    <br />
                    触发后可能: 催促/担忧/非语言线索/闲聊。
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">等待消息...</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Heart className="h-4 w-4 text-rose-500" />
                情绪引擎
              </h4>
              {state ? (
                <>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-medium px-1.5 py-0.5 rounded",
                        state.emotion.score >= 1
                          ? "bg-green-100 text-green-700"
                          : state.emotion.score <= -1
                            ? "bg-red-100 text-red-700"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {state.emotion.state} ({state.emotion.score > 0 ? `+${state.emotion.score}` : state.emotion.score})
                    </span>
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        state.emotion.score >= 1 ? "bg-green-500" : state.emotion.score <= -1 ? "bg-red-500" : "bg-amber-400",
                      )}
                      style={{ width: `${((state.emotion.score + 2) / 4) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{state.emotion.note}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">加载中...</p>
              )}
              <button onClick={refreshState} className="text-xs text-primary hover:underline flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                刷新
              </button>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Brain className="h-4 w-4 text-purple-500" />
                患者人格
              </h4>
              {state?.personality && Object.keys(state.personality).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(state.personality).map(([dim, val]) => {
                    const Icon = PERSONALITY_ICONS[dim] || Brain;
                    const barW = (personalityBarValue(val as string) / 5) * 100;
                    const label = (PERSONALITY_LABELS[dim] || {})[val as string] || val;
                    return (
                      <div key={dim} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1">
                            <Icon className="h-3 w-3 text-muted-foreground" />
                            {dim === "health_literacy" ? "健康素养" : dim === "verbosity" ? "健谈度" : dim === "anxiety_trait" ? "焦虑倾向" : "耐心度"}
                          </span>
                          <span className="text-muted-foreground">{label}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full", PERSONALITY_BAR_COLORS[dim] || "bg-primary")} style={{ width: `${barW}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">(未配置人格)</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-blue-500" />
                对话统计
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted/50 rounded p-2">
                  <span className="text-muted-foreground">总消息</span>
                  <div className="text-lg font-semibold">{messages.length}</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <span className="text-muted-foreground">患者回复</span>
                  <div className="text-lg font-semibold">{patientMsgs.length}</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <span className="text-muted-foreground">间隔</span>
                  <div className="text-lg font-semibold">{lastResponseTime ? `${lastResponseTime}s` : "—"}</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <span className="text-muted-foreground">配置</span>
                  <div className="text-sm font-semibold">{state?.config.mode || "—"}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Stethoscope className="h-4 w-4 text-emerald-500" />
                体征锚点
              </h4>
              {state?.exam_anchors && Object.keys(state.exam_anchors).length > 0 ? (
                <div className="space-y-2 text-xs">
                  {Object.entries(state.exam_anchors).map(([k, v]) => (
                    <div key={k} className="bg-muted/50 rounded p-2">
                      <div className="font-medium text-muted-foreground mb-0.5">
                        {k === "vital_signs" ? "生命体征" : k === "auscultation" ? "听诊" : k === "skin" ? "皮肤" : k === "pain_score" ? "疼痛评分" : k}
                      </div>
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
                <p className="text-xs text-muted-foreground">(无查体锚点)</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h4 className="text-sm font-semibold">功能开关</h4>
              {state?.config?.features && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(state.config.features).map(([k, v]) => (
                    <span key={k} className={cn("px-1.5 py-0.5 rounded text-[10px]", v ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")}>
                      {k}: {v ? "ON" : "OFF"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

interface OperationResult {
  type: string;
  label: string;
  value: string;
  unit?: string;
}
