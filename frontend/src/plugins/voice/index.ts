import type { TrainingPlugin } from "@/engine/types";
import { VoiceButton } from "./VoiceButton";

export const voicePlugin: TrainingPlugin = {
  id: "voice",
  name: "语音交互",
  meta: {
    description: "TTS 自动朗读患者回复 + 语音输入",
    icon: "mic",
    tags: ["ui", "input", "tts"],
  },
  slots: {
    "input-toolbar": VoiceButton,
  },
};
