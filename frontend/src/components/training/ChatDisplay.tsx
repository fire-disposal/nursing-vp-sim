import { useCallback, useEffect, useRef, useState } from "react";
import { ChatBubble } from "@/components/ChatBubble";
import { getEmotionBorder, useEmotion, usePortrait } from "@/engine/PluginContext";
import type { ChatMessage, PatientData } from "@/engine/types";
import { getPatientAvatar } from "@/utils/avatar";

interface ChatDisplayProps {
  messages: ChatMessage[];
  patient: PatientData;
  bus: { on: (event: string, handler: (...args: any[]) => void) => () => void };
}

export function ChatDisplay({ messages, patient, bus }: ChatDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const { portraitUrl } = usePortrait();
  const { emotion } = useEmotion();

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (force || isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: force ? "auto" : "smooth" });
    }
  }, []);

  const lastScrollSet = useRef(0);
  const handleScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastScrollSet.current < 100) return;
    lastScrollSet.current = now;
    const near = checkNearBottom();
    isNearBottomRef.current = near;
    setIsNearBottom(near);
  }, [checkNearBottom]);

  useEffect(() => {
    const count = messages.length;
    if (count > prevCountRef.current) scrollToBottom(true);
    prevCountRef.current = count;
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const unsub = bus.on("stream:chunk", () => {
      if (isNearBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "auto" });
    });
    return unsub;
  }, [bus]);

  const patientAvatar = portraitUrl || getPatientAvatar({ name: patient.name, gender: patient.gender });
  const nurseAvatar = getPatientAvatar({ name: "Nurse", gender: "female" });
  const emotionBorder = getEmotionBorder(emotion);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scroll-smooth px-2 py-4 space-y-3" onScroll={handleScroll}>
      {messages.map((msg, i) => (
        <ChatBubble
          key={msg.id ?? i}
          message={msg}
          patientAvatar={patientAvatar}
          nurseAvatar={nurseAvatar}
          emotionBorder={emotionBorder}
          portraitUrl={portraitUrl}
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
