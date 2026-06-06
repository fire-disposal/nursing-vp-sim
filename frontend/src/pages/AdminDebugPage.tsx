import { ArrowLeft, Bug, Heart, RefreshCw, Send, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/axios-instance";
import Layout from "@/components/Layout";
import OperationPanel from "@/components/OperationPanel";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import { getNurseAvatar, getPatientAvatar } from "@/utils/avatar";

interface CaseBrief {
  id: number;
  name: string;
  difficulty: number;
  description?: string;
  patient_summary?: { name: string; age: number; gender: string };
}

interface ChatMessage {
  id?: number;
  role: string;
  content: string;
  streaming?: boolean;
}

interface EmotionState {
  score: number;
  state: string;
  note: string;
}

interface TrainingState {
  emotion: EmotionState;
  personality: Record<string, string>;
  deep_background_keys: string[];
  exam_anchors: Record<string, string | Record<string, string>>;
  config: { id: string; mode: string; features: Record<string, boolean> };
}

interface OperationResult {
  type: string;
  label: string;
  value: string;
  unit?: string;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.get("/api/cases", { params: { limit: 50 } }).then((r: { data: { items: CaseBrief[] } }) => setCases(r.data.items));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const refreshState = async () => {
    if (!recordId) return;
    try {
      const r = await api.get(`/api/training/${recordId}/state`);
      setState(r.data);
    } catch {
      /* ignore */
    }
  };

  const startTraining = async () => {
    if (!selectedCaseId) return;
    setLoading(true);
    try {
      const r = await api.post("/api/training/start", { case_id: selectedCaseId, config_id: "free-exploration" });
      setRecordId(r.data.record_id);
      setMessages([{ role: "patient", content: r.data.greeting }]);
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`/api/chat/${recordId}/message/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No reader");

      let fullReply = "";
      setMessages((prev) => [...prev, { role: "patient", content: "", streaming: true }]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullReply += data.content;
                setMessages((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (next[lastIdx]?.streaming) {
                    next[lastIdx] = { ...next[lastIdx], content: fullReply };
                  }
                  return next;
                });
              }
              if (data.done) break;
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }

      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
      await refreshState();
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => prev.filter((m) => !m.streaming && m.content !== content));
      }
    } finally {
      setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const endTraining = async () => {
    if (!recordId) return;
    setEnding(true);
    try {
      await api.post(`/api/training/${recordId}/end`);
    } finally {
      setEnding(false);
      navigate("/home");
    }
  };

  const caseData = cases.find((c) => c.id === selectedCaseId);

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
                      {c.name} (★{c.difficulty}) {c.patient_summary ? `— ${c.patient_summary.name}` : ""}
                    </option>
                  ))}
                </select>
                <Button onClick={startTraining} disabled={!selectedCaseId || loading} className="w-full">
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
                  <button onClick={endTraining} disabled={ending} className="text-xs px-2 py-1 rounded border border-destructive/50 text-destructive">
                    {ending ? "结束中..." : "结束"}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg, i) => (
                  <div key={i} className={cn("flex gap-2", msg.role === "student" ? "justify-end" : "justify-start")}>
                    {msg.role === "patient" && <img className="w-7 h-7 rounded-full shrink-0 bg-muted" src={getPatientAvatar()} alt="" />}
                    <div
                      className={cn(
                        "max-w-[75%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                        msg.role === "student" ? "bg-primary text-primary-foreground" : "bg-muted",
                        msg.streaming && "after:content-['|'] after:animate-pulse",
                      )}
                    >
                      {msg.content}
                    </div>
                    {msg.role === "student" && <img className="w-7 h-7 rounded-full shrink-0 bg-muted" src={getNurseAvatar()} alt="" />}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <OperationPanel onOperation={(cmd) => handleSend(cmd)} results={opResults} disabled={loading || ending} />

              <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && !e.shiftKey && handleSend()}
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
                <Heart className="h-4 w-4 text-rose-500" />
                情绪状态机
              </h4>
              {state ? (
                <>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          state.emotion.score >= 1 ? "bg-green-500" : state.emotion.score <= -1 ? "bg-red-500" : "bg-amber-400",
                        )}
                        style={{ width: `${((state.emotion.score + 2) / 4) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums w-6">{state.emotion.score > 0 ? `+${state.emotion.score}` : state.emotion.score}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{state.emotion.note}</p>
                  <div className="text-xs space-y-1 bg-muted/50 rounded p-2">
                    <span className="font-medium">人格:</span>{" "}
                    {Object.entries(state.personality || {}).map(([k, v]) => (
                      <span key={k} className="ml-1 px-1 py-0.5 rounded bg-border/50">
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs space-y-1 bg-muted/50 rounded p-2">
                    <span className="font-medium">背景字段:</span> {state.deep_background_keys.join(" · ") || "(无)"}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">加载中...</p>
              )}
              <button onClick={refreshState} className="text-xs text-primary hover:underline">
                <RefreshCw className="inline h-3 w-3 mr-1" />
                刷新状态
              </button>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h4 className="text-sm font-semibold">会话配置</h4>
              {state?.config && (
                <div className="text-xs space-y-1">
                  <div>
                    模式: <span className="font-medium">{state.config.mode}</span>
                  </div>
                  <div>
                    配置: <span className="font-medium">{state.config.id}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(state.config.features || {}).map(([k, v]) => (
                      <span key={k} className={cn("px-1.5 py-0.5 rounded text-[10px]", v ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")}>
                        {k}: {v ? "ON" : "OFF"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h4 className="text-sm font-semibold">查体锚点</h4>
              {state?.exam_anchors && (
                <div className="text-xs space-y-1 font-mono max-h-40 overflow-y-auto">
                  {Object.keys(state.exam_anchors).length === 0
                    ? "(该病例未配置查体锚点)"
                    : Object.entries(state.exam_anchors).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-muted-foreground">{k}</span>
                          <span>{typeof v === "string" ? v : JSON.stringify(v)}</span>
                        </div>
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
