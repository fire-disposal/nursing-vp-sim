import type { TTSProvider } from "./types";

/**
 * 火山引擎 TTS 提供器（接口预留）
 *
 * 接入步骤：
 * 1. 在火山引擎控制台开通语音合成服务，获取 AppId / Token / Cluster
 * 2. 将凭证配置到环境变量或后端 endpoint
 * 3. 取消下方注释，实现 speak() 调用后端代理 API
 * 4. 在 TTSManager 中将 provider 替换为此实例
 */

export function createVolcengineTTS(_config: {
  endpoint: string; // 后端代理 URL，如 /api/tts/volcengine/synthesize
}): TTSProvider {
  let _speaking = false;
  let _abortController: AbortController | null = null;

  return {
    get speaking() {
      return _speaking;
    },

    get providerName() {
      return "volcengine-tts";
    },

    async speak(text: string): Promise<void> {
      _abortController?.abort();
      _abortController = new AbortController();
      _speaking = true;

      try {
        const token = localStorage.getItem("token");
        const response = await fetch(_config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text, voice: "zh_female_qingrun" }),
          signal: _abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`TTS 请求失败: ${response.status}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        await new Promise<void>((resolve, reject) => {
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            reject(new Error("音频播放失败"));
          };
          audio.play().catch(reject);
        });
      } catch (err: any) {
        if (err.name === "AbortError") return;
        throw err;
      } finally {
        _speaking = false;
        _abortController = null;
      }
    },

    stop(): void {
      _speaking = false;
      _abortController?.abort();
    },
  };
}
