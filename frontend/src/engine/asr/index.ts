import { webSpeechAsrProvider } from "./webSpeech";
import { createVolcAsrProvider } from "./volc";
import type { AsrProvider } from "./types";

export type { AsrEventHandlers, AsrProvider, AsrResult, AsrSession } from "./types";
export { webSpeechAsrProvider, createVolcAsrProvider };
export { ASR_WS_PATH, buildAsrUrl, closeReason, connectVolcAsr } from "./volcStream";
export type { VolcAsrCloseReason, VolcAsrConnection } from "./volcStream";
export { VAD_ASSET_PATH, VAD_MODEL, VAD_TUNING, VAD_WORKLET, loadMicVad, startVadSession } from "@/engine/audio/vad";
export type { VadCallbacks, VadHandle } from "@/engine/audio/vad";

/** 默认 ASR 供应商：同源云转写（豆包流式 ASR）。 */
export const defaultAsrProvider: AsrProvider = createVolcAsrProvider();

/** 降级供应商：浏览器 Web Speech（零后端，无 VAD）。 */
export const fallbackAsrProvider: AsrProvider = webSpeechAsrProvider;
