import { ArrowLeft, Clock, Ear, EarOff, Phone } from "lucide-react";
import NursingRecordPanel from "@/components/nursing-record/NursingRecordPanel";
import InquirySidebar from "@/components/training/InquirySidebar";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import type { PatientInfo } from "@/utils/avatar";
import { getPatientAvatar } from "@/utils/avatar";

interface TrainingHeaderProps {
  patientName: string;
  caseTitle: string;
  patientInfo: PatientInfo | null;
  remaining: number | null;
  formatTime: (sec: number | null) => string;
  ending: boolean;
  messagesLength: number;
  inquiries: string[];
  studentMessages: ChatMessage[];
  showNursingRecord: boolean;
  onToggleNursingRecord: () => void;
  voiceAutoPlay: boolean;
  voiceSpeechSupported: boolean;
  onToggleAutoPlay: () => void;
  recordId: string;
  onBack: () => void;
  onEnd: () => void;
}

export default function TrainingHeader({
  patientName,
  caseTitle,
  patientInfo,
  remaining,
  formatTime,
  ending,
  messagesLength,
  inquiries,
  studentMessages,
  showNursingRecord,
  onToggleNursingRecord,
  voiceAutoPlay,
  voiceSpeechSupported,
  onToggleAutoPlay,
  recordId,
  onBack,
  onEnd,
}: TrainingHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-card px-4 pb-3 sm:px-4 sm:py-0 sm:h-14" style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}>
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <button
          className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors"
          onClick={onBack}
          title="返回首页"
          aria-label="返回首页"
        >
          <ArrowLeft size={16} className="sm:size-[18px]" />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <img
            className="w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
            src={getPatientAvatar(patientInfo)}
            alt={patientName || "虚拟患者"}
          />
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-semibold text-foreground truncate">{patientName || "虚拟患者"}</div>
            <div className="text-[0.65rem] sm:text-xs text-muted-foreground truncate">{caseTitle}</div>
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border bg-card shrink-0",
            remaining !== null && remaining <= 120 && "border-red-200 bg-red-50 text-red-600",
            remaining !== null && remaining > 120 && remaining <= 300 && "border-amber-200 bg-amber-50 text-amber-600",
            remaining === null || remaining > 300 ? "border-border text-muted-foreground" : "",
          )}
        >
          <Clock size={12} className="sm:size-[14px] shrink-0" />
          <span>{formatTime(remaining)}</span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5">
          {inquiries.length > 0 && <InquirySidebar inquiries={inquiries} studentMessages={studentMessages} />}

          <NursingRecordPanel isOpen={showNursingRecord} onToggle={onToggleNursingRecord} recordId={recordId || "default"} />

          {voiceSpeechSupported && (
            <button
              className={cn(
                "w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 transition-colors hover:bg-muted",
                voiceAutoPlay && "border-primary bg-primary/10 text-primary hover:bg-primary/20",
              )}
              onClick={onToggleAutoPlay}
              title={voiceAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
              aria-label={voiceAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
            >
              {voiceAutoPlay ? <Ear size={14} className="sm:size-[16px]" /> : <EarOff size={14} className="sm:size-[16px]" />}
            </button>
          )}

          <button
            className="flex items-center gap-1 px-2.5 h-10 sm:h-9 rounded-md border border-destructive/30 bg-card text-destructive text-xs sm:text-sm font-medium shrink-0 hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onEnd}
            disabled={ending || messagesLength <= 1}
            aria-label="结束训练"
          >
            <Phone size={13} className="sm:size-[15px] sm:block hidden" />
            <span className="sm:hidden">结束</span>
            <span className="hidden sm:inline">{ending ? "评分中..." : "结束训练"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
