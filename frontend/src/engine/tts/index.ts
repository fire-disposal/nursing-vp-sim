import type { TTSProvider } from "./types";

export { createBrowserTTS } from "./browser-tts";
export type { TTSProvider } from "./types";
export { createVolcengineTTS } from "./volcengine-tts";

export function createTTSProvider(type: "browser" | "volcengine" | TTSProvider): TTSProvider {
  if (typeof type !== "string") return type;
  if (type === "volcengine") {
    return createVolcengineTTS({ endpoint: "/api/tts/volcengine/synthesize" });
  }
  return createBrowserTTS();
}
