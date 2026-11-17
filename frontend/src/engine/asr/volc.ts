import { MicCapture } from "@/engine/audio/mic";
import { startVadSession as defaultStartVad, type VadHandle } from "@/engine/audio/vad";
import type { AsrEventHandlers, AsrProvider, AsrSession } from "./types";
import { connectVolcAsr, type VolcAsrConnection } from "./volcStream";

/**
 * 豆包（火山）流式 ASR 供应商 —— 默认语音输入。
 *
 * 一条会话由两块组成，各自可独立失败：
 *  采集/轮次：`MicCapture`（一条流、一个 AudioContext）+ `startVadSession`（Silero VAD v5）。
 *             VAD 跟不上实时 → 只跑 `interim` 路径（PCM 照常上云，静音窗口判句尾）。
 *  转写：`connectVolcAsr` 把 worklet 产出的 PCM16LE 发到同源 WS，收 partial/definite。
 *
 * 鉴权只有 JWT：ASR 的 API Key 在服务端 `VoiceConfig` 里，前端不出现任何密钥。
 */

export interface VolcAsrDeps {
	/** 单测注入：不打开麦克风/WS。 */
	openCapture?: typeof MicCapture.open;
	startVad?: typeof defaultStartVad;
	connect?: typeof connectVolcAsr;
}

export interface VolcAsrProviderOptions {
	/** WS 路径（同源）。默认 `/api/asr/stream`。 */
	path?: string;
}

export function createVolcAsrProvider(
	options: VolcAsrProviderOptions = {},
	deps: VolcAsrDeps = {},
): AsrProvider {
	const path = options.path;
	return {
		id: "volc-asr-stream",
		supported() {
			if (typeof window === "undefined") return false;
			if (typeof WebSocket === "undefined") return false;
			// 采集靠 getUserMedia + AudioWorklet；缺任何一个都只能走 Web Speech 降级。
			return !!navigator.mediaDevices?.getUserMedia;
		},
		createSession(sessionOptions = {}) {
			const { openCapture = MicCapture.open, startVad = defaultStartVad, connect = connectVolcAsr } = deps;
			const session: AsrSession = {
				// VAD 校准落地前不算"有轮次检测"：这段时间的事件会被校准门挡掉，
				// 状态机必须按 interim 驱动跑，否则会出现"既没 VAD 事件也没 interim"的空转。
				turnDetection: false,
				start: () => {
					void run();
				},
				stop: () => {
					void teardown();
				},
				beginEchoCalibration: () => capture?.beginEchoCalibration(),
			};

			let closed = false;
			let capture: MicCapture | null = null;
			let vad: VadHandle | null = null;
			let connection: VolcAsrConnection | null = null;

			/** 唯一的对外发事件口：关闭后不再上报（迟到的上游帧不得抵达状态机）。 */
			const emit = <K extends keyof AsrEventHandlers>(
				key: K,
				...args: Parameters<NonNullable<AsrEventHandlers[K]>>
			) => {
				if (closed) return;
				const fn = session[key] as ((...a: Parameters<NonNullable<AsrEventHandlers[K]>>) => void) | undefined;
				if (!fn) return;
				try {
					fn(...args);
				} catch (err) {
					console.error(`[volc-asr] ${String(key)} 回调失败`, err);
				}
			};

			const teardown = async () => {
				if (closed) return;
				closed = true;
				try {
					connection?.close();
				} catch {
					/* 已关闭 */
				}
				connection = null;
				await vad?.destroy().catch(() => {});
				vad = null;
				await capture?.close().catch(() => {});
				capture = null;
			};

			const run = async () => {
				if (!sessionOptions.token || sessionOptions.recordId == null) {
					emit("onError", "missing_auth");
					return;
				}
				try {
					// 无论调用方有没有现成的流，采集链路（一条流 + 一个 AudioContext）都由这里持有：
					// PCM 转发、麦克风活跃度、VAD 复用三件事必须挂在同一个图上。
					capture = await openCapture({
						stream: sessionOptions.stream ?? null,
						audioContext: sessionOptions.audioContext ?? null,
						echoLevel: sessionOptions.echoLevel,
						onEchoCalibration: sessionOptions.onEchoCalibration,
						echoReference: sessionOptions.echoReference,
						markerOnsets: sessionOptions.markerOnsets,
						onEchoSuppression: sessionOptions.onEchoSuppression,
						onCleanedPcm: sessionOptions.onCleanedPcm,
						onPcmFrame: sessionOptions.onPcmFrame,
						onFrame: sessionOptions.onFrame,
						pcm: { onPcm: (pcm) => connection?.send(pcm) },
					});
				} catch (err) {
					console.warn("[volc-asr] 麦克风采集失败", err);
					emit("onError", "mic_unavailable");
					return;
				}
				if (closed) {
					await capture?.close().catch(() => {});
					return;
				}

				try {
					connection = await connect({
						path: path ?? (sessionOptions.recordId === 0 ? "/api/voice-demo/asr" : "/api/asr/stream"),
						token: sessionOptions.token,
						recordId: sessionOptions.recordId,
						onReady: () => emit("onReady"),
						onPartial: (text) => {
							emit("onPartial", text);
							// VAD 缺席（初始化失败/校准期降级）：由中间结果驱动静音窗口
							if (!session.turnDetection) emit("onInterim", text);
						},
						onDefinite: (text) => emit("onDefinite", text),
						onEnd: () => emit("onEnd"),
						onError: (message) => emit("onError", message),
					});
				} catch (err) {
					console.warn("[volc-asr] 云转写连接失败", err);
					emit("onError", (err instanceof Error && err.message) || "connect_failed");
					await teardown();
					return;
				}

				if (!sessionOptions.vad) return;
				const handle = await startVad({
					stream: capture?.stream ?? sessionOptions.stream ?? null,
					audioContext: capture?.audioContext,
					callbacks: {
						onSpeechStart: () => {
							if (!capture?.isCurrentEcho()) emit("onSpeechStart");
						},
						onSpeechRealStart: () => {
							if (!capture?.isCurrentEcho()) emit("onSpeechRealStart");
						},
						// 端点交给 definite：speechEnd 只是"大概说完了"，转写可能还在路上
						onMisfire: () => {},
						onPerformance: (state) => {
							session.turnDetection = state === "ok";
							emit("onPerformance", state);
						},
					},
				});
				if (closed) {
					await handle?.destroy().catch(() => {});
					return;
				}
				vad = handle;
				if (!handle) session.turnDetection = false;
			};

			return session;
		},
	};
}
