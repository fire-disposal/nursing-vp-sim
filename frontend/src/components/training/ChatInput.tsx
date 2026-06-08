import { Mic, MicOff, RefreshCw, Send, WifiOff } from "lucide-react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: (retryContent?: string) => void;
  onVoiceInput: () => void;
  onFocus?: () => void;
  loading: boolean;
  ending: boolean;
  remaining: number | null;
  isOnline: boolean;
  isListening: boolean;
  voiceSupported: boolean;
  failedMessage: string | null;
  maxLength?: number;
}

export default function ChatInput({
  input,
  onInputChange,
  onSend,
  onVoiceInput,
  onFocus,
  loading,
  ending,
  remaining,
  isOnline,
  isListening,
  voiceSupported,
  failedMessage,
  maxLength = 2000,
}: ChatInputProps) {
  const isDisabled = loading || ending || remaining === 0 || !isOnline;

  return (
    <div className="flex items-center gap-2 px-3 sm:px-6 py-3 bg-card border-t border-border shrink-0">
      {voiceSupported && (
        <button
          className={cn(
            "size-11 rounded-full border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted active:scale-95 transition-transform transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
            isListening && "border-destructive bg-destructive/10 text-destructive",
          )}
          onClick={onVoiceInput}
          disabled={isDisabled}
          title={isListening ? "停止录音" : "语音输入"}
          aria-label={isListening ? "停止录音" : "语音输入"}
        >
          {isListening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
      )}

      {!isOnline && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 shrink-0">
          <WifiOff size={14} />
          <span className="hidden sm:inline">网络已断开</span>
        </div>
      )}

      {failedMessage && !loading ? (
        <button
          className="flex items-center gap-1.5 px-3 h-10 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium shrink-0 hover:bg-amber-100 transition-colors"
          onClick={() => onSend(failedMessage)}
        >
          <RefreshCw size={14} />
          <span>重新发送</span>
        </button>
      ) : null}

      <div className="flex items-center gap-2 flex-1 relative">
        <input
          type="text"
          value={input}
          maxLength={maxLength}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && !e.shiftKey && onSend()}
          onFocus={onFocus}
          placeholder={!isOnline ? "网络已断开" : remaining === 0 ? "训练时间已结束" : "输入你的问题，按 Enter 发送..."}
          disabled={isDisabled}
          enterKeyHint="send"
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="text"
          className="flex-1 h-11 px-4 rounded-full border border-border bg-muted text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 focus:bg-background transition-all disabled:opacity-50"
        />
        {input.length > 0 && (
          <span
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none",
              input.length >= maxLength ? "text-destructive font-medium" : input.length >= maxLength * 0.85 ? "text-amber-600" : "text-muted-foreground/60",
            )}
          >
            {input.length}/{maxLength}
          </span>
        )}
      </div>

      <button
        className="size-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        onClick={() => onSend()}
        disabled={!input.trim() || isDisabled}
        aria-label="发送消息"
      >
        <Send size={17} />
      </button>
    </div>
  );
}
