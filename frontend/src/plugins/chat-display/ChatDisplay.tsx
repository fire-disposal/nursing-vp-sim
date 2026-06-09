import { useCallback, useEffect, useRef, useState } from "react";
import ChatBubble from "@/components/ChatBubble";
import type { SlotProps } from "@/engine/types";
import { getNurseAvatar, getPatientAvatar } from "@/utils/avatar";

export function ChatDisplay({ ctx }: SlotProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const prevMessageCountRef = useRef(0);

  const nurseAvatar = getNurseAvatar();

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    const threshold = 80;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback(
    (force = false) => {
      if (force || isNearBottom) {
        bottomRef.current?.scrollIntoView({ behavior: force ? "auto" : "smooth" });
      }
    },
    [isNearBottom],
  );

  const handleScroll = useCallback(() => {
    setIsNearBottom(checkNearBottom());
  }, [checkNearBottom]);

  // Auto-scroll when new messages arrive (streaming or new)
  useEffect(() => {
    const count = ctx.messages.length;
    const last = ctx.messages[count - 1];
    if (count > prevMessageCountRef.current || last?.streaming) {
      scrollToBottom(count === prevMessageCountRef.current + 1 && last?.role === "student");
    }
    prevMessageCountRef.current = count;
  }, [ctx.messages, scrollToBottom]);

  // Listen for stream chunks to keep scroll pinned during streaming
  useEffect(() => {
    const unsub = ctx.bus.on("stream:chunk", () => {
      if (isNearBottom) {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }
    });
    return unsub;
  }, [ctx.bus, isNearBottom]);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  if (ctx.messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        <div className="text-center space-y-3">
          <p className="text-lg">👋 欢迎来到护理问诊训练</p>
          <p>请在下方输入框开始与患者对话</p>
          <button
            type="button"
            onClick={() => ctx.tts.setAutoPlay(!ctx.tts.isAutoPlay)}
            className={`mx-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
              ctx.tts.isAutoPlay ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {ctx.tts.isAutoPlay ? "🔊 自动朗读" : "🔇 朗读已关"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scroll-smooth px-2 py-4 space-y-3" onScroll={handleScroll}>
      {ctx.messages.map((msg, i) => (
        <ChatBubble
          key={msg.id ?? i}
          message={msg}
          patientAvatar={getPatientAvatar({ name: ctx.patient.name, gender: ctx.patient.gender })}
          nurseAvatar={nurseAvatar}
        />
      ))}
      <div ref={bottomRef} className="h-1" />

      {!isNearBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="fixed bottom-24 right-4 z-30 flex size-9 items-center justify-center rounded-full border bg-background shadow-md hover:bg-muted transition-colors"
          aria-label="滚动到最新消息"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-foreground" role="img">
            <title>滚动到最新消息</title>
            <path d="M8 3v7m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
