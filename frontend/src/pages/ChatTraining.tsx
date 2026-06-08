import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ChatBubble from "@/components/ChatBubble";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { useToast } from "@/components/Toast";
import ChatInput from "@/components/training/ChatInput";
import OperationPanel from "@/components/training/OperationPanel";
import PatientPortrait from "@/components/training/PatientPortrait";
import ScoreCard from "@/components/training/ScoreCard";
import ScoringOverlay from "@/components/training/ScoringOverlay";
import TrainingHeader from "@/components/training/TrainingHeader";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useChatStream } from "@/hooks/useChatStream";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import { useRecordLoader } from "@/hooks/useRecordLoader";
import { useScorePolling } from "@/hooks/useScorePolling";
import { useScoreProgress } from "@/hooks/useScoreProgress";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { useTypingFreeze } from "@/hooks/useTypingFreeze";
import useVoice from "@/hooks/useVoice";
import type { ChatMessage } from "@/types/chat";
import type { ScoreData } from "@/types/score";
import { getNurseAvatar, getPatientAvatar, type PatientInfo } from "@/utils/avatar";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();
  const [input, setInput] = useState("");
  const [ending, setEnding] = useState(false);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [caseTitle, setCaseTitle] = useState("");
  const [requiredInquiries, setRequiredInquiries] = useState<string[]>([]);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [showPortrait, setShowPortrait] = useState(true);
  const [showNursingRecord, setShowNursingRecord] = useState(false);
  const [recordStatus, setRecordStatus] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [showPreQuestionnaire, setShowPreQuestionnaire] = useState(false);
  const [showPostQuestionnaire, setShowPostQuestionnaire] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const failedMessageRef = useRef<string | null>(null);
  const prevShowScoreRef = useRef(false);

  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const isOnline = useNetworkStatus();
  const voice = useVoice({ patientGender: patientInfo?.gender, patientAge: patientInfo?.age });

  const pendingContentRef = useRef("");
  const { messages, setMessages, send, loading, abortRef } = useChatStream(recordId ? Number(recordId) : null, {
    onPatientChunk: (chunk: string) => voice.speakStreamChunk(chunk),
    onPatientDone: () => voice.flushStreamSpeak(),
    onError: (err: string) => {
      toast.error(err);
      failedMessageRef.current = pendingContentRef.current;
    },
  });

  const { markTyping } = useTypingFreeze();

  const handleScoreReady = (data: ScoreData) => {
    setScore(data);
    setShowScore(true);
    fastForward();
  };

  const { executeEnd, scoreCancelRef } = useScorePolling({
    recordId: recordId ? Number(recordId) : null,
    onScoreReady: handleScoreReady,
    onPostTestCheck: () => postTest.check(),
  });

  const { remaining, formatTime, resetTimer, setRemaining, setTimerActive } = useTrainingTimer({
    initialRemaining: null,
    onAutoEnd: () => executeEnd(true),
  });

  useRecordLoader(recordId, {
    setMessages: (msgs) => setMessages((msgs as ChatMessage[]).map((m) => ({ ...m, streaming: false }))),
    setCaseTitle,
    setRequiredInquiries,
    setPatientName,
    setPatientInfo: (info) => setPatientInfo(info as PatientInfo),
    setCaseId,
    setFeatures,
    setRecordStatus,
    setScore,
    setShowScore,
    onTimerReady: (r) => {
      resetTimer();
      if (r != null && r > 0) {
        setRemaining(r);
        setTimerActive(true);
      }
      if (r === null || r === 0) {
        setRemaining(null);
        setTimerActive(false);
      }
    },
    onPreTestCheck: async () => {
      const result = await preTest.check();
      if (!result) return undefined;
      return { has_pending: result.has_pending };
    },
  });

  const { progress: scoreProgress, fastForward } = useScoreProgress(ending);

  useEffect(() => {
    if (!showScore) return;
    fastForward();
  }, [showScore, fastForward]);

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

  const preTest = useQuestionnaire({
    caseId,
    trigger: "before_training",
    onComplete: () => setShowPreQuestionnaire(false),
  });

  const postTest = useQuestionnaire({
    caseId,
    recordId: recordId ? Number(recordId) : null,
    trigger: "after_scoring",
    onComplete: () => setShowPostQuestionnaire(false),
  });

  const studentMessages = useMemo(() => messages.filter((m) => m.role === "student"), [messages]);

  const handleSend = async (retryContent?: string) => {
    const content = retryContent || input.trim();
    if (!content || loading) return;
    if (content.length > 2000) return;
    if (retryContent) {
      failedMessageRef.current = null;
    } else {
      setInput("");
    }
    pendingContentRef.current = content;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    voice.resetSpeakState();
    await send(content);
  };

  const handleEnd = async () => {
    const ok = await confirm({
      title: "结束训练",
      message: "确定结束本次训练吗？结束后将自动评分，可能需要等待数十秒。",
      confirmLabel: "确定结束",
      danger: true,
    });
    if (!ok) return;
    setEnding(true);
    setShowOverlay(true);
    executeEnd(false);
  };

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

  const handleInputFocus = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 300);
  }, []);

  const handleSpeakToggle = (text: string) => {
    if (voice.isSpeaking) {
      voice.stopSpeak();
    } else {
      voice.speakRaw(text);
    }
  };

  return (
    <div className="flex flex-col h-dvh bg-background">
      <TrainingHeader
        patientName={patientName}
        caseTitle={caseTitle}
        patientInfo={patientInfo}
        remaining={remaining}
        formatTime={formatTime}
        ending={ending}
        messagesLength={messages.length}
        inquiries={requiredInquiries}
        studentMessages={studentMessages}
        showNursingRecord={showNursingRecord}
        onToggleNursingRecord={() => setShowNursingRecord((v) => !v)}
        voiceAutoPlay={voice.autoPlay}
        voiceSpeechSupported={voice.speechSupported.synthesis}
        onToggleAutoPlay={() => {
          if (voice.autoPlay) voice.stopSpeak();
          voice.setAutoPlay(!voice.autoPlay);
        }}
        recordId={recordId || "default"}
        onBack={async () => {
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
        onEnd={handleEnd}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <PatientPortrait patientInfo={patientInfo} collapsed={!showPortrait} onToggle={() => setShowPortrait((v) => !v)} />

        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-3 sm:gap-4 w-full">
          <div className="flex-1" />

          {messages.length <= 1 && (
            <div className="text-center py-12 sm:py-16 text-muted-foreground">
              <div className="flex items-center justify-center mb-4">
                <img className="w-12 h-12 rounded-full object-cover bg-muted ring-2 ring-border" src={getPatientAvatar(patientInfo)} alt="患者" />
              </div>
              <p className="text-sm font-medium text-foreground/70">请按照护理评估流程与患者交流</p>
              <span className="text-xs block mt-1 text-muted-foreground/70">从主诉开始，逐步了解现病史、既往史、用药史等信息</span>
            </div>
          )}

          {remaining == null && recordStatus === "completed" && !score && messages.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 mb-3 text-sm text-amber-700 dark:text-amber-400">
              训练已结束，暂无评分。可在记录详情中请求评分。
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble
              key={msg.id ?? i}
              message={msg}
              patientAvatar={getPatientAvatar(patientInfo)}
              nurseAvatar={getNurseAvatar()}
              showSpeakButton={voice.speechSupported.synthesis && !voice.autoPlay}
              isSpeaking={voice.isSpeaking}
              onSpeakToggle={handleSpeakToggle}
            />
          ))}

          {loading && !messages.some((m) => m.streaming) && (
            <>
              <div className="flex items-end gap-2 justify-start">
                <img className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted" src={getPatientAvatar(patientInfo)} alt="患者" />
                <div className="bg-card text-foreground border border-border rounded-2xl rounded-bl-md px-4 py-3">
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
                  className="px-4 py-1.5 rounded-lg border border-border bg-card text-muted-foreground text-xs hover:bg-muted transition-colors"
                >
                  跳过等待，稍后在记录中查看
                </button>
              </div>
            </>
          )}

          {remaining === 0 && (
            <div className="text-center mx-2 sm:mx-4 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm font-semibold">
              训练时间已结束，系统正在自动评分...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {features.physical_exam && (
        <div className="flex items-center gap-2 px-3 sm:px-6 py-1.5 bg-card border-t border-border shrink-0">
          <OperationPanel
            onOperation={(cmd) => {
              setInput(cmd);
              handleSend(cmd);
            }}
            results={[]}
            disabled={loading || ending || remaining === 0 || !isOnline}
          />
        </div>
      )}

      <ChatInput
        input={input}
        onInputChange={(v) => {
          setInput(v);
          markTyping();
        }}
        onSend={handleSend}
        onVoiceInput={toggleVoice}
        onFocus={handleInputFocus}
        loading={loading}
        ending={ending}
        remaining={remaining}
        isOnline={isOnline}
        isListening={voice.isListening}
        voiceSupported={voice.speechSupported.recognition}
        failedMessage={failedMessageRef.current}
      />

      {showOverlay && (
        <ScoringOverlay
          progress={scoreProgress}
          onCancel={() => {
            scoreCancelRef.current = true;
            setEnding(false);
            setShowOverlay(false);
          }}
        />
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

      {showPreQuestionnaire && preTest.checkResponse && (
        <QuestionnaireModal
          open={showPreQuestionnaire}
          onComplete={() => setShowPreQuestionnaire(false)}
          onSkip={() => setShowPreQuestionnaire(false)}
          checkResponse={preTest.checkResponse}
          loading={preTest.isLoading}
          onSubmit={preTest.submit}
        />
      )}

      {showPostQuestionnaire && postTest.checkResponse && (
        <QuestionnaireModal
          open={showPostQuestionnaire}
          onComplete={() => setShowPostQuestionnaire(false)}
          onSkip={() => setShowPostQuestionnaire(false)}
          checkResponse={postTest.checkResponse}
          loading={postTest.isLoading}
          onSubmit={postTest.submit}
        />
      )}

      <style>{`
        .typing-dots {
          display: flex;
          gap: 4px;
          padding: 2px 0;
        }
        .typing-dots span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: hsl(var(--muted-foreground) / 0.4);
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
