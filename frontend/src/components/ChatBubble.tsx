import { Info, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

interface ChatBubbleProps {
  message: ChatMessage;
  patientAvatar: string;
  nurseAvatar: string;
  showSpeakButton?: boolean;
  isSpeaking?: boolean;
  onSpeakToggle?: (text: string) => void;
}

export default function ChatBubble({ message, patientAvatar, nurseAvatar, showSpeakButton = false, isSpeaking = false, onSpeakToggle }: ChatBubbleProps) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="flex items-start gap-2 max-w-[85%] rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="whitespace-pre-wrap leading-relaxed text-blue-800">{message.content}</div>
        </div>
      </div>
    );
  }

  if (message.role === "patient") {
    return (
      <div className="flex items-end gap-2 justify-start">
        <img className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted" src={patientAvatar} alt="患者" />
        <div
          className={cn(
            "max-w-[90%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl text-sm leading-relaxed break-words",
            "bg-card text-foreground border border-border rounded-bl-md",
            message.streaming && "after:content-['▎'] after:animate-pulse after:text-primary after:font-bold",
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {showSpeakButton && !message.streaming && (
          <button
            className="w-7 h-7 rounded-md border border-border bg-card flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            onClick={() => onSpeakToggle?.(message.content)}
            title={isSpeaking ? "停止朗读" : "朗读"}
          >
            {isSpeaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 justify-end">
      <div
        className={cn(
          "max-w-[90%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed break-words",
          "bg-primary text-primary-foreground",
          message.streaming && "after:content-['|'] after:animate-pulse",
        )}
      >
        {message.content || (message.streaming ? "" : "")}
      </div>
      <img className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted" src={nurseAvatar} alt="护士" />
    </div>
  );
}
