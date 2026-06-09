import { useEffect, useRef, useState } from "react";
import type { SlotProps } from "@/engine/types";

declare global {
  interface Window {
    SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance;
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export function VoiceButton({ ctx }: SlotProps) {
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem("voice_autoPlay") !== "false");
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem("voice_autoPlay", String(autoPlay));
  }, [autoPlay]);

  useEffect(() => {
    if (!autoPlay) return;
    const unsub = ctx.bus.on("stream:done", () => {
      const msgs = document.querySelectorAll("[data-role='patient']");
      const last = msgs[msgs.length - 1];
      if (last) {
        const text = last.textContent ?? "";
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-CN";
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    });
    return unsub;
  }, [autoPlay, ctx.bus]);

  const toggleListen = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }

    const recog = new SpeechRecognition();
    recog.lang = "zh-CN";
    recog.interimResults = true;
    recogRef.current = recog;

    recog.onresult = (e: any) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      if (e.results[0]?.isFinal) {
        ctx.sendMessage(transcript);
        setListening(false);
      }
    };

    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);

    recog.start();
    setListening(true);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setAutoPlay((v) => !v)}
        className={`text-xs px-1 rounded ${autoPlay ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}
        title={autoPlay ? "自动朗读开" : "自动朗读关"}
      >
        🔊
      </button>
      <button
        onClick={toggleListen}
        className={`text-xs px-1 rounded ${listening ? "bg-red-500/20 text-red-500 animate-pulse" : "text-muted-foreground"}`}
        title="语音输入"
      >
        🎤
      </button>
    </div>
  );
}
