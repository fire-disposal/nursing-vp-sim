import type { TTSProvider } from "./types";

export function createBrowserTTS(): TTSProvider {
  let _speaking = false;

  return {
    get speaking() {
      return _speaking;
    },

    get providerName() {
      return "browser-speech-synthesis";
    },

    speak(text: string): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!window.speechSynthesis) {
          reject(new Error("浏览器不支持语音合成"));
          return;
        }

        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "zh-CN";
        utterance.rate = 0.95;

        const voices = speechSynthesis.getVoices();
        const zhVoice = voices.find((v) => v.lang.startsWith("zh"));
        if (zhVoice) utterance.voice = zhVoice;

        utterance.onstart = () => {
          _speaking = true;
        };

        utterance.onend = () => {
          _speaking = false;
          resolve();
        };

        utterance.onerror = (e) => {
          _speaking = false;
          if (e.error === "canceled" || e.error === "interrupted") {
            resolve();
          } else {
            reject(new Error(`语音合成失败: ${e.error}`));
          }
        };

        speechSynthesis.speak(utterance);
      });
    },

    stop(): void {
      _speaking = false;
      speechSynthesis.cancel();
    },
  };
}
