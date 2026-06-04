import { ArrowLeft, CheckCircle2, Circle, Clock, Ear, EarOff, ListChecks, Mic, MicOff, Phone, Send, Volume2, VolumeX, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { endTraining, getRecordDetail, sendMessageStream } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import PatientPortrait from "@/components/PatientPortrait";
import ScoreCard from "@/components/ScoreCard";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import useVoice from "@/hooks/useVoice";
import { getNurseAvatar, getPatientAvatar, type PatientInfo } from "@/utils/avatar";
import { cn } from "@/lib/utils";

type TrainingRecordDetail = components["schemas"]["TrainingRecordDetail"];
type MessageItem = components["schemas"]["MessageItem"];

interface ChatMessage {
  id: number;
  role: string;
  content: string;
  streaming?: boolean;
}

interface ScoreData {
  total_score: number;
  detail_scores?: Record<string, { score: number; max: number; items?: { id: number; name: string; score: number }[] }>;
  strengths?: string[];
  weaknesses?: string[];
  missed_content?: string[];
  suggestions?: string;
  rubric_version?: string;
}

function extractKeywords(inquiry: string): string[] {
  const cleaned = inquiry.replace(/[（）()]/g, " ");
  const tokens: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    tokens.push(cleaned.slice(i, i + 2));
  }
  return [...new Set(tokens.filter((t) => t.trim().length === 2))];
}

function getInquiryLabel(inquiry: string): string {
  return inquiry
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .slice(0, 18);
}

interface InquirySidebarProps {
  inquiries: string[];
  studentMessages: ChatMessage[];
  isOpen: boolean;
  onToggle: () => void;
}

function InquirySidebar({ inquiries, studentMessages, isOpen, onToggle }: InquirySidebarProps) {
  const addressed = useMemo(() => {
    if (!inquiries || inquiries.length === 0) return new Set<number>();
    const allText = studentMessages.map((m) => m.content).join("");
    const result = new Set<number>();
    inquiries.forEach((inquiry, idx) => {
      const keywords = extractKeywords(inquiry);
      const matched = keywords.some((kw) => allText.includes(kw));
      if (matched) result.add(idx);
    });
    return result;
  }, [inquiries, studentMessages]);

  const covered = addressed.size;
  const total = inquiries.length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

  return (
    <>
      <button
        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 bg-white cursor-pointer text-sm font-medium text-gray-700 transition-all"
        onClick={onToggle}
        title="采集进度"
      >
        <ListChecks size={16} />
        <span>
          {covered}/{total}
        </span>
        {pct < 100 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500" />}
      </button>

      <div
        className={cn(
          "fixed top-0 right-0 bottom-0 w-[300px] max-w-[85vw] bg-white z-[1000] flex flex-col transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0 shadow-[-2px_0_20px_rgba(0,0,0,0.1)]" : "translate-x-full",
        )}
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-border">
          <h3 className="text-base font-bold flex items-center gap-2">
            <ListChecks size={18} /> 采集进度
          </h3>
          <button onClick={onToggle} className="w-7 h-7 rounded-md border border-border bg-white cursor-pointer flex items-center justify-center">
            <X size={14} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100">
          <div className="flex justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">关键问诊内容覆盖</span>
            <span className={cn("text-sm font-bold", pct >= 80 ? "text-green-700" : pct >= 40 ? "text-amber-700" : "text-red-600")}>
              {covered}/{total}
            </span>
          </div>
          <div className="h-1.5 rounded-sm bg-gray-200 overflow-hidden">
            <div
              className={cn("h-full rounded-sm transition-[width] duration-500", pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto py-2">
          {inquiries.map((inquiry, idx) => {
            const done = addressed.has(idx);
            return (
              <div key={idx} className={cn("flex items-start gap-2.5 px-6 py-2 text-sm transition-colors", done ? "text-gray-700" : "text-gray-400")}>
                {done ? <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" /> : <Circle size={16} className="text-gray-300 shrink-0 mt-0.5" />}
                <span className="leading-relaxed">{getInquiryLabel(inquiry)}</span>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
          提示：系统根据对话关键词自动匹配，仅供参考。建议按护理评估框架全面采集病史。
        </div>
      </div>

      {isOpen && <div onClick={onToggle} className="fixed inset-0 bg-black/30 z-[999]" />}
    </>
  );
}

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [scoreProgress, setScoreProgress] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [caseTitle, setCaseTitle] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [timerActive, setTimerActive] = useState(false);
  const [requiredInquiries, setRequiredInquiries] = useState<string[]>([]);
  const [showInquirySidebar, setShowInquirySidebar] = useState(false);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [showPortrait, setShowPortrait] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoEndRef = useRef(false);
  const warned5Ref = useRef(false);
  const warned2Ref = useRef(false);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressSpeedRef = useRef(0);
  const prevShowScoreRef = useRef(false);
  const scoreCancelRef = useRef(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const voice = useVoice({ patientGender: patientInfo?.gender, patientAge: patientInfo?.age });

  const toggleVoice = () => {
    voice.startListening().then(
      (text) => setInput(text),
      (err) => {
        if (err.error === "not-allowed") toast.warning("麦克风权限被拒绝，请在浏览器设置中允许");
        else if (err.error === "no-speech") toast.info("未检测到语音，请重试");
        else if (err.message) toast.info(err.message);
        else toast.info("语音识别失败，请重试");
      },
    );
  };

  const handleSpeakToggle = (text: string) => {
    if (voice.isSpeaking) {
      voice.stopSpeak();
    } else {
      voice.speakRaw(text);
    }
  };

  const studentMessages = useMemo(() => messages.filter((m) => m.role === "student"), [messages]);

  useEffect(() => {
    if (!timerActive) return;
    timerRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s == null) return s;
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerActive]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    const isActive = () => remaining != null && remaining > 0 && !score && !ending;
    const handler = (e: BeforeUnloadEvent) => {
      if (isActive()) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [remaining, score, ending]);

  useEffect(() => {
    setTimerActive(false);
    setRemaining(null);
    warned5Ref.current = false;
    warned2Ref.current = false;
    autoEndRef.current = false;
    let cancelled = false;
    getRecordDetail(Number(recordId))
      .then(({ data }) => {
        if (cancelled) return;
        const detail = data as TrainingRecordDetail;
        setMessages(
          ((detail.messages || []) as ChatMessage[]).map((m) => ({
            ...m,
            streaming: false,
          })),
        );
        if (detail.case_name) setCaseTitle(detail.case_name);
        if (detail.required_inquiries) setRequiredInquiries(detail.required_inquiries as string[]);
        if (detail.patient_info) setPatientInfo(detail.patient_info as PatientInfo);
        const r =
          detail.remaining_seconds != null
            ? detail.remaining_seconds
            : Math.max(0, (detail.time_limit || 20) * 60 - Math.floor((Date.now() - new Date(detail.start_time).getTime()) / 1000));
        setRemaining(r);
        setTimerActive(true);
        if (detail.messages && detail.messages.length > 0) {
          const m = detail.messages[0].content.match(/我是(.+?)[。，]/);
          if (m) setPatientName(m[1]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("加载训练记录失败");
          navigate("/cases");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [recordId, toast.error, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || loading) return;
    setInput("");
    const studentMsgId = Date.now();
    const patientMsgId = studentMsgId + 1;
    setMessages((prev) => [
      ...prev,
      { role: "student", content, id: studentMsgId },
      {
        role: "patient",
        content: "",
        id: patientMsgId,
        streaming: true,
      },
    ]);
    setLoading(true);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    voice.resetSpeakState();

    await sendMessageStream(
      Number(recordId),
      content,
      (chunk: string) => {
        setMessages((prev) => prev.map((msg) => (msg.id === patientMsgId ? { ...msg, content: msg.content + chunk } : msg)));
        voice.speakStreamChunk(chunk);
      },
      (doneId?: number) => {
        setMessages((prev) => prev.map((msg) => (msg.id === patientMsgId ? { ...msg, streaming: false, id: doneId || msg.id } : msg)));
        voice.flushStreamSpeak();
        setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      },
      (error: string) => {
        toast.error(error);
        setMessages((prev) => prev.filter((msg) => msg.id !== patientMsgId));
        setInput(content);
        setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      },
      controller.signal,
    );
  };

  const executeEnd = async (isAuto = false) => {
    setEnding(true);
    if (timerRef.current) clearInterval(timerRef.current);

    const controller = new AbortController();
    abortRef.current = controller;
    scoreCancelRef.current = false;

    try {
      await endTraining(Number(recordId), controller.signal);
      for (let i = 0; i < 40; i++) {
        if (scoreCancelRef.current) break;
        await new Promise<void>((r) => setTimeout(r, 3000));
        const detail = await getRecordDetail(Number(recordId));
        if (detail.data.scoring_status === "completed" && detail.data.score) {
          setScore(detail.data.score as ScoreData);
          setShowScore(true);
          break;
        }
        if (detail.data.scoring_status === "failed") {
          toast.error(`自动评分失败：${detail.data.scoring_error || "未知错误，可在训练记录中手动重试"}`);
          break;
        }
      }
    } catch (err: unknown) {
      const axiosErr = err as { name?: string; code?: string; response?: { data?: { detail?: string } } };
      if (axiosErr.name !== "CanceledError" && axiosErr.code !== "ERR_CANCELED") {
        if (!isAuto) toast.error(axiosErr.response?.data?.detail || "结束训练失败，请重试");
      }
    } finally {
      setEnding(false);
      setShowOverlay(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleEnd = async () => {
    const ok = await confirm({
      title: "结束训练",
      message: "确定结束本次训练吗？结束后将自动评分，可能需要等待数十秒。",
      confirmLabel: "确定结束",
      danger: true,
    });
    if (!ok) return;
    executeEnd(false);
  };

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 300 && remaining > 299 && !warned5Ref.current) {
      warned5Ref.current = true;
      toast.warning("训练时间剩余 5 分钟");
    }
    if (remaining <= 120 && remaining > 119 && !warned2Ref.current) {
      warned2Ref.current = true;
      toast.warning("训练时间剩余 2 分钟，即将自动结束");
    }
    if (remaining === 0 && !autoEndRef.current) {
      toast.info("训练时间已结束，正在自动评分...");
    }
  }, [remaining, toast.warning, toast.info]);

  useEffect(() => {
    if (remaining === 0 && !ending && !showScore) {
      if (autoEndRef.current) return;
      autoEndRef.current = true;
      executeEnd(true);
    }
  }, [remaining, ending, showScore, executeEnd]);

  useEffect(() => {
    if (!ending) return;
    setShowOverlay(true);
    setScoreProgress(0);
    progressSpeedRef.current = 100 / (15 * 20);

    progressIntervalRef.current = setInterval(() => {
      setScoreProgress((prev) => {
        const next = prev + progressSpeedRef.current;
        return Math.min(next, 100);
      });
    }, 50);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [ending]);

  useEffect(() => {
    if (!showScore) return;
    progressSpeedRef.current = 8;
  }, [showScore]);

  useEffect(() => {
    if (!scoreProgress && !showScore) return;
    if (prevShowScoreRef.current && !showScore && showOverlay) {
      setShowOverlay(false);
    }
    prevShowScoreRef.current = showScore;
  }, [showScore, showOverlay, scoreProgress]);

  useEffect(() => {
    if (scoreProgress >= 100 && showScore) {
      const timer = setTimeout(() => setShowOverlay(false), 300);
      return () => clearTimeout(timer);
    }
  }, [scoreProgress, showScore]);

  const formatTime = (sec: number | null): string => {
    if (sec == null) return "--:--";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center h-14 px-4 bg-card border-b border-border gap-3 shrink-0">
        <button
          className="w-[34px] h-[34px] border border-border rounded-lg bg-white text-gray-500 cursor-pointer flex items-center justify-center hover:bg-gray-50"
          onClick={async () => {
            const isActive = remaining != null && remaining > 0 && !score && !ending;
            if (isActive) {
              const ok = await confirm({
                title: "离开训练",
                message: "训练还在进行中，离开将丢失当前进度，确认离开吗？",
                confirmLabel: "确认离开",
                danger: true,
              });
              if (!ok) return;
            }
            navigate("/home");
          }}
          title="返回首页"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2.5 flex-1">
          <img className="w-9 h-9 rounded-full object-cover object-center bg-gray-100" src={getPatientAvatar(patientInfo)} alt={patientName || "虚拟患者"} />
          <div>
            <div className="text-sm font-semibold text-foreground">{patientName || "虚拟患者"}</div>
            <div className="text-xs text-muted-foreground">
              {caseTitle} · {loading ? "正在输入..." : "在线"}
            </div>
          </div>
        </div>

        {requiredInquiries.length > 0 && (
          <InquirySidebar
            inquiries={requiredInquiries}
            studentMessages={studentMessages}
            isOpen={showInquirySidebar}
            onToggle={() => setShowInquirySidebar((v) => !v)}
          />
        )}

        <div
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold tabular-nums border border-gray-200 bg-gray-50 text-gray-700",
            remaining !== null && remaining <= 120 && "bg-red-50 border-red-300 text-red-600",
            remaining !== null && remaining > 120 && remaining <= 300 && "bg-amber-50 border-amber-200 text-amber-600",
          )}
        >
          <Clock size={16} className="text-gray-400 shrink-0" />
          <span>{formatTime(remaining)}</span>
        </div>
        {voice.speechSupported.synthesis && (
          <button
            className={cn(
              "flex items-center justify-center w-[34px] h-[34px] p-0 border border-gray-200 rounded-lg bg-gray-50 text-gray-400 cursor-pointer transition-all hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50",
              voice.autoPlay && "border-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100",
            )}
            onClick={() => voice.setAutoPlay(!voice.autoPlay)}
            title={voice.autoPlay ? "关闭自动朗读" : "开启自动朗读"}
          >
            {voice.autoPlay ? <Ear size={16} /> : <EarOff size={16} />}
          </button>
        )}
        <button
          className="flex items-center gap-1.5 px-3.5 py-1.5 border border-red-200 rounded-lg bg-white text-red-500 text-sm font-medium cursor-pointer hover:bg-red-50 disabled:opacity-35 disabled:cursor-not-allowed"
          onClick={handleEnd}
          disabled={ending || messages.length <= 1}
        >
          <Phone size={16} />
          <span>{ending ? "评分中..." : "结束训练"}</span>
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <PatientPortrait patientInfo={patientInfo} collapsed={!showPortrait} onToggle={() => setShowPortrait((v) => !v)} />

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 max-w-[800px] mx-auto w-full">
          {messages.length <= 1 && (
            <div className="text-center pt-16 pb-6 text-muted-foreground">
              <div className="flex items-center justify-center mb-3 text-gray-400">
                <img className="w-9 h-9 rounded-full object-cover object-center bg-gray-100" src={getPatientAvatar(patientInfo)} alt="患者" />
              </div>
              <p className="text-sm font-medium mt-3 text-gray-500">请按照护理评估流程与患者交流</p>
              <span className="text-xs block mt-1">从主诉开始，逐步了解现病史、既往史、用药史等信息</span>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={msg.id || i} className={cn("flex items-end gap-1.5", msg.role === "student" ? "justify-end" : "justify-start")}>
              {msg.role === "patient" && (
                <img className="w-8 h-8 rounded-full object-cover object-center shrink-0 bg-gray-100" src={getPatientAvatar(patientInfo)} alt="患者" />
              )}
              <div
                className={cn(
                  "max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                  msg.role === "student" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-white text-gray-800 border border-gray-200 rounded-bl-md",
                  msg.streaming && "streaming-cursor",
                )}
              >
                <p>
                  {msg.content}
                  {msg.streaming ? "" : ""}
                </p>
              </div>
              {msg.role === "student" && (
                <img className="w-8 h-8 rounded-full object-cover object-center shrink-0 bg-gray-100" src={getNurseAvatar()} alt="护士" />
              )}
              {msg.role === "patient" && !msg.streaming && !voice.autoPlay && voice.speechSupported.synthesis && (
                <button
                  className="w-7 h-7 border border-gray-200 rounded-md bg-white cursor-pointer flex items-center justify-center opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
                  onClick={() => handleSpeakToggle(msg.content)}
                  title={voice.isSpeaking ? "停止朗读" : "朗读"}
                >
                  {voice.isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              )}
            </div>
          ))}
          {loading && !messages.some((m) => m.streaming) && (
            <>
              <div className="flex items-end gap-1.5 justify-start">
                <img className="w-8 h-8 rounded-full object-cover object-center shrink-0 bg-gray-100" src={getPatientAvatar(patientInfo)} alt="患者" />
                <div className="bg-white text-gray-800 border border-gray-200 rounded-2xl rounded-bl-md px-4 py-2.5">
                  <div className="typing-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
              <div className="flex justify-center mt-2">
                <button
                  onClick={() => {
                    scoreCancelRef.current = true;
                    setEnding(false);
                    setShowOverlay(false);
                  }}
                  className="px-6 py-2 border border-border rounded-lg bg-card text-muted-foreground cursor-pointer text-sm"
                >
                  跳过等待，稍后在记录中查看
                </button>
              </div>
            </>
          )}
          {remaining === 0 && (
            <div className="text-center mx-4 px-4 py-3 bg-red-50 border border-red-300 rounded-lg text-red-600 text-sm font-semibold">
              训练时间已结束，系统正在自动评分...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="flex items-center gap-2 px-6 py-3 bg-card border-t border-border shrink-0">
        {voice.speechSupported.recognition && (
          <button
            className={cn(
              "w-10 h-10 rounded-full border border-gray-200 bg-white text-gray-500 cursor-pointer flex items-center justify-center shrink-0 hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed",
              voice.isListening && "bg-red-50 border-red-200 text-red-500",
            )}
            onClick={toggleVoice}
            disabled={loading || ending || remaining === 0}
            title={voice.isListening ? "停止录音" : "语音输入"}
          >
            {voice.isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder={remaining === 0 ? "训练时间已结束" : "输入你的问题，按 Enter 发送..."}
          disabled={loading || ending || remaining === 0}
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-3xl text-sm font-[inherit] bg-gray-50 focus:outline-none focus:border-blue-500 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)] focus:bg-white"
        />
        <button
          className="w-10 h-10 rounded-full bg-blue-600 text-white border-0 cursor-pointer flex items-center justify-center shrink-0 hover:bg-blue-700 disabled:opacity-35 disabled:cursor-not-allowed"
          onClick={handleSend}
          disabled={!input.trim() || loading || ending || remaining === 0}
        >
          <Send size={18} />
        </button>
      </div>

      {showOverlay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[200] backdrop-blur-sm">
          <div className="bg-white rounded-2xl text-center px-8 py-10 max-w-[420px] w-[92vw] shadow-2xl">
            <div className="w-12 h-12 mx-auto mb-5 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
            <h3 className="mb-2 text-lg">{scoreProgress >= 100 ? "评分完成，即将展示报告" : "AI 正在评分"}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">正在分析你的训练表现，根据问诊完整性、沟通技巧等维度进行评分，请耐心等待...</p>
            <div className="h-1.5 rounded-sm bg-gray-200 overflow-hidden mb-6">
              <div
                className={cn("h-full rounded-sm", scoreProgress >= 100 ? "bg-green-500" : "bg-blue-600")}
                style={{ width: `${scoreProgress}%`, transition: scoreProgress >= 100 ? "none" : "width 0.05s linear" }}
              />
            </div>
            <button
              onClick={() => {
                scoreCancelRef.current = true;
                setEnding(false);
                setShowOverlay(false);
                navigate("/home");
              }}
              className="px-6 py-2 border border-border rounded-lg bg-card text-muted-foreground cursor-pointer text-sm"
            >
              稍后在记录中查看，先回首页
            </button>
          </div>
        </div>
      )}

      {showScore && score && (
        <ScoreCard
          score={score}
          onClose={() => setShowScore(false)}
          onRetry={() => navigate("/cases")}
          onGoHome={() =>
            navigate("/home", {
              state: { feedbackPrompt: Date.now() },
            })
          }
        />
      )}

      <style>{`
        .streaming-cursor::after {
          content: "|";
          animation: blink 0.8s infinite;
          color: #3b82f6;
          font-weight: 700;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .typing-dots {
          display: flex;
          gap: 4px;
          padding: 4px 0;
        }
        .typing-dots span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #d1d5db;
          animation: bounce-dot 1.4s infinite ease-in-out;
        }
        .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
        .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce-dot {
          0%, 80%, 100% { transform: scale(0.3); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
