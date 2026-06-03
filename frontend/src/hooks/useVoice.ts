import { useCallback, useEffect, useRef, useState } from "react";

const SENTENCE_RE = /[^。！？；\n]*[。！？；\n]/g;

function purifyText(text: string): string {
  return text
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function jitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range;
}

function calcSpeechRate(age?: number | null): number {
  const effectiveAge = age ?? 45;
  if (effectiveAge >= 70) return jitter(0.78, 0.04);
  if (effectiveAge >= 60) return jitter(0.83, 0.04);
  if (effectiveAge >= 45) return jitter(0.88, 0.04);
  if (effectiveAge >= 15) return jitter(0.93, 0.04);
  return jitter(0.95, 0.04);
}

function calcPitch(age?: number | null): number {
  const effectiveAge = age ?? 45;
  if (effectiveAge >= 70) return jitter(0.92, 0.03);
  if (effectiveAge >= 60) return jitter(0.96, 0.03);
  if (effectiveAge >= 45) return jitter(1.0, 0.03);
  if (effectiveAge >= 15) return jitter(1.07, 0.03);
  return jitter(1.12, 0.03);
}

function calcPauseMs(age?: number | null): number {
  const effectiveAge = age ?? 45;
  if (effectiveAge >= 70) return jitter(380, 80);
  if (effectiveAge >= 60) return jitter(300, 70);
  if (effectiveAge >= 45) return jitter(240, 60);
  if (effectiveAge >= 15) return jitter(200, 50);
  return jitter(180, 40);
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

const FEMALE_KEYWORDS = ["Female", "女", "Tingting", "Xiaoxiao", "Xiaoyi"];
const MALE_KEYWORDS = ["Male", "男", "Yunxi", "Yunjian", "Yunyang", "Yunfeng"];

function pickVoice(gender?: string | null): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const zhCN = voices.filter((v) => v.lang.startsWith("zh-CN"));

  const preferMale = gender === "男";
  const primaryKw = preferMale ? MALE_KEYWORDS : FEMALE_KEYWORDS;
  const fallbackKw = preferMale ? FEMALE_KEYWORDS : MALE_KEYWORDS;

  const best = zhCN.find((v) => primaryKw.some((k) => v.name.includes(k)));
  if (best) return best;
  const second = zhCN.find((v) => fallbackKw.some((k) => v.name.includes(k)));
  if (second) return second;
  if (zhCN.length > 0) return zhCN[0];
  const zh = voices.find((v) => v.lang.startsWith("zh"));
  if (zh) return zh;
  return voices[0];
}

interface SpeechSupport {
  recognition: boolean;
  synthesis: boolean;
}

export interface UseVoiceConfig {
  patientGender?: string | null;
  patientAge?: number | null;
}

export interface UseVoiceReturn {
  speechSupported: SpeechSupport;
  isSpeaking: boolean;
  isListening: boolean;
  autoPlay: boolean;
  setAutoPlay: (v: boolean) => void;
  speak: (text: string) => void;
  speakRaw: (text: string) => Promise<void>;
  speakStreamChunk: (chunk: string) => void;
  flushStreamSpeak: () => void;
  stopSpeak: () => void;
  resetSpeakState: () => void;
  startListening: () => Promise<string>;
  stopListening: () => void;
}

export default function useVoice(config: UseVoiceConfig = {}): UseVoiceReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoPlay, setAutoPlay] = useState<boolean>(() => localStorage.getItem("voiceAutoPlay") === "true");

  useEffect(() => {
    localStorage.setItem("voiceAutoPlay", autoPlay ? "true" : "false");
  }, [autoPlay]);
  const [speechSupported, setSpeechSupported] = useState<SpeechSupport>({ recognition: false, synthesis: false });

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const genderRef = useRef<string | null | undefined>(config.patientGender);
  genderRef.current = config.patientGender;
  const ageRef = useRef<number | null | undefined>(config.patientAge);
  ageRef.current = config.patientAge;

  const bufferRef = useRef("");
  const spokenLenRef = useRef(0);
  const speakPromRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const rec = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const syn = !!window.speechSynthesis;
    setSpeechSupported({ recognition: rec, synthesis: syn });
    if (syn) {
      voiceRef.current = pickVoice(genderRef.current);
      const onVoicesChanged = () => {
        voiceRef.current = pickVoice(genderRef.current);
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  useEffect(() => {
    if (window.speechSynthesis) {
      voiceRef.current = pickVoice(config.patientGender);
    }
  }, [config.patientGender]);

  const stopSpeak = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    bufferRef.current = "";
  }, []);

  const speakRaw = useCallback((text: string): Promise<void> => {
    const purified = purifyText(text);
    if (!window.speechSynthesis || !purified) return Promise.resolve();
    window.speechSynthesis.cancel();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(purified);
      u.lang = "zh-CN";
      u.rate = calcSpeechRate(ageRef.current);
      u.pitch = calcPitch(ageRef.current);
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
    (text: string): void => {
      if (!autoPlay) return;
      const portion = text.slice(spokenLenRef.current);
      if (!portion.trim()) return;
      spokenLenRef.current = text.length;
      speakPromRef.current = speakPromRef.current.then(() => speakRaw(portion));
    },
    [autoPlay, speakRaw],
  );

  const speakStreamChunk = useCallback(
    (chunk: string): void => {
      if (!autoPlay) return;
      bufferRef.current += chunk;
      const buf = bufferRef.current;
      const matches = buf.match(SENTENCE_RE);
      if (!matches || matches.length === 0) return;
      let consumed = 0;
      for (const m of matches) {
        speakPromRef.current = speakPromRef.current.then(() => speakRaw(m)).then(() => delay(calcPauseMs(ageRef.current)));
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

  const startListening = useCallback((): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        reject(new Error("浏览器不支持语音输入"));
        return;
      }
      const recognition = new SR();
      recognition.lang = "zh-CN";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (e) => {
        setIsListening(false);
        resolve(e.results[0]![0]!.transcript);
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
