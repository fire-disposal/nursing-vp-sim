import { useCallback, useEffect, useRef, useState } from "react";

const SENTENCE_RE = /[^。！？；\n]*[。！？；\n]/g;

function pickVoice() {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const zhCN = voices.filter((v) => v.lang.startsWith("zh-CN"));
  const female = zhCN.find((v) => v.name.includes("Female") || v.name.includes("女") || v.name.includes("Tingting") || v.name.includes("Xiaoxiao"));
  if (female) return female;
  if (zhCN.length > 0) return zhCN[0];
  const zh = voices.find((v) => v.lang.startsWith("zh"));
  if (zh) return zh;
  return voices[0];
}

export default function useVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speechSupported, setSpeechSupported] = useState({ recognition: false, synthesis: false });

  const voiceRef = useRef(null);
  const bufferRef = useRef("");
  const spokenLenRef = useRef(0);
  const speakPromRef = useRef(Promise.resolve());

  useEffect(() => {
    const rec = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const syn = !!window.speechSynthesis;
    setSpeechSupported({ recognition: rec, synthesis: syn });
    if (syn) {
      voiceRef.current = pickVoice();
      const onVoicesChanged = () => {
        voiceRef.current = pickVoice();
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  const stopSpeak = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    bufferRef.current = "";
  }, []);

  const speakRaw = useCallback((text) => {
    if (!window.speechSynthesis || !text.trim()) return Promise.resolve();
    window.speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = 0.9;
      if (voiceRef.current) u.voice = voiceRef.current;
      u.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      u.onerror = () => {
        setIsSpeaking(false);
        resolve();
      };
      setIsSpeaking(true);
      window.speechSynthesis.speak(u);
    });
  }, []);

  const speak = useCallback(
    (text) => {
      if (!autoPlay) return;
      const portion = text.slice(spokenLenRef.current);
      if (!portion.trim()) return;
      spokenLenRef.current = text.length;
      speakPromRef.current = speakPromRef.current.then(() => speakRaw(portion));
    },
    [autoPlay, speakRaw],
  );

  const speakStreamChunk = useCallback(
    (chunk) => {
      if (!autoPlay) return;
      bufferRef.current += chunk;
      const buf = bufferRef.current;
      const matches = buf.match(SENTENCE_RE);
      if (!matches || matches.length === 0) return;
      let consumed = 0;
      for (const m of matches) {
        speakPromRef.current = speakPromRef.current.then(() => speakRaw(m));
        consumed += m.length;
      }
      bufferRef.current = buf.slice(consumed);
    },
    [autoPlay, speakRaw],
  );

  const flushStreamSpeak = useCallback(() => {
    const remaining = bufferRef.current.trim();
    bufferRef.current = "";
    if (!remaining || !autoPlay) return;
    speakPromRef.current = speakPromRef.current.then(() => speakRaw(remaining));
  }, [autoPlay, speakRaw]);

  const resetSpeakState = useCallback(() => {
    spokenLenRef.current = 0;
    bufferRef.current = "";
  }, []);

  const startListening = useCallback(() => {
    return new Promise((resolve, reject) => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        reject(new Error("浏览器不支持语音输入"));
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = "zh-CN";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (e) => {
        setIsListening(false);
        resolve(e.results[0][0].transcript);
      };
      recognition.onerror = (e) => {
        setIsListening(false);
        reject(e);
      };
      recognition.onend = () => setIsListening(false);
      recognition.start();
      setIsListening(true);
    });
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
  }, []);

  return {
    speechSupported,
    isSpeaking,
    isListening,
    autoPlay,
    setAutoPlay,
    speak,
    speakRaw,
    speakStreamChunk,
    flushStreamSpeak,
    stopSpeak,
    resetSpeakState,
    startListening,
    stopListening,
  };
}
