import { webSpeechAsrProvider } from "./webSpeech";
import type { AsrProvider } from "./types";

export type { AsrProvider, AsrResult, AsrSession } from "./types";
export { webSpeechAsrProvider };

/** 当前启用的 ASR 实现（唯一实现；未来在线 ASR 在此切换）。 */
export const defaultAsrProvider: AsrProvider = webSpeechAsrProvider;
