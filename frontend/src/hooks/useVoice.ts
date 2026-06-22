import { useCallback, useEffect, useRef, useState } from "react";
import { fetchASRStatus } from "@/api/admin/voice-cost";
import useAuthStore from "@/stores/authStore";

const TARGET_RATE = 16000;

const WORKLET_CODE = `
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

function downsampleToInt16(input: Float32Array, inRate: number): Int16Array {
	const ratio = inRate === TARGET_RATE ? 1 : inRate / TARGET_RATE;
	const outLen = Math.floor(input.length / ratio);
	const out = new Int16Array(outLen);
	for (let i = 0; i < outLen; i++) {
		const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return out;
}

function buildWsUrl(): string {
	const token = useAuthStore.getState().token ?? "";
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/api/asr/stream?token=${encodeURIComponent(token)}`;
}

interface ServerMsg {
	type: "partial" | "final" | "error" | "unavailable";
	text?: string;
	confidence?: number;
}

export interface UseVoiceReturn {
	available: boolean;
	isListening: boolean;
	isProcessing: boolean;
	partialText: string;
	startListening: () => Promise<string>;
	stopListening: () => void;
	cancelListening: () => void;
}

export default function useVoice(): UseVoiceReturn {
	const [available, setAvailable] = useState(true);
	const [isListening, setIsListening] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [partialText, setPartialText] = useState("");

	const wsRef = useRef<WebSocket | null>(null);
	const ctxRef = useRef<AudioContext | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const nodeRef = useRef<AudioNode | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const resolveRef = useRef<((text: string) => void) | null>(null);
	const partialRef = useRef("");
	const settledRef = useRef(false);

	const updatePartial = useCallback((text: string) => {
		partialRef.current = text;
		setPartialText(text);
	}, []);

	useEffect(() => {
		let cancelled = false;
		fetchASRStatus()
			.then((r) => {
				if (!cancelled) setAvailable(r.data.available);
			})
			.catch(() => {
				if (!cancelled) setAvailable(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const teardown = useCallback(() => {
		try {
			nodeRef.current?.disconnect();
			sourceRef.current?.disconnect();
		} catch {
			/* ignore */
		}
		if (streamRef.current) {
			for (const t of streamRef.current.getTracks()) t.stop();
		}
		if (ctxRef.current && ctxRef.current.state !== "closed") {
			void ctxRef.current.close();
		}
		if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
			wsRef.current.close();
		}
		nodeRef.current = null;
		sourceRef.current = null;
		streamRef.current = null;
		ctxRef.current = null;
		wsRef.current = null;
	}, []);

	const settle = useCallback(
		(text: string) => {
			if (settledRef.current) return;
			settledRef.current = true;
			setIsListening(false);
			setIsProcessing(false);
			teardown();
			resolveRef.current?.(text);
			resolveRef.current = null;
		},
		[teardown],
	);

	const startListening = useCallback((): Promise<string> => {
		return new Promise((resolve, reject) => {
			void (async () => {
				settledRef.current = false;
				resolveRef.current = resolve;
				updatePartial("");

				let stream: MediaStream;
				try {
					stream = await navigator.mediaDevices.getUserMedia({
						audio: { channelCount: 1, sampleRate: TARGET_RATE },
					});
				} catch (err) {
					setAvailable(false);
					settledRef.current = true;
					resolveRef.current = null;
					reject(err instanceof Error ? err : new Error("麦克风不可用"));
					return;
				}
				streamRef.current = stream;

				const AudioCtx =
					window.AudioContext ??
					(window as unknown as { webkitAudioContext: typeof AudioContext })
						.webkitAudioContext;
				const ctx = new AudioCtx();
				ctxRef.current = ctx;
				if (ctx.state === "suspended") await ctx.resume();
				const inRate = ctx.sampleRate;

				const ws = new WebSocket(buildWsUrl());
				ws.binaryType = "arraybuffer";
				wsRef.current = ws;
				let wsOpen = false;

				const sendPcm = (frame: Float32Array) => {
					if (!wsOpen || ws.readyState !== WebSocket.OPEN) return;
					ws.send(downsampleToInt16(frame, inRate).buffer);
				};

				ws.onopen = () => {
					wsOpen = true;
				};
				ws.onmessage = (ev) => {
					let msg: ServerMsg;
					try {
						msg = JSON.parse(ev.data as string) as ServerMsg;
					} catch {
						return;
					}
					if (msg.type === "partial") {
						updatePartial(msg.text ?? "");
					} else if (msg.type === "final") {
						updatePartial(msg.text ?? "");
						settle(msg.text ?? "");
					} else if (msg.type === "unavailable") {
						setAvailable(false);
						settle("");
					} else if (msg.type === "error") {
						settle(partialRef.current);
					}
				};
				ws.onerror = () => settle("");
				ws.onclose = () => settle(partialRef.current);

				const source = ctx.createMediaStreamSource(stream);
				sourceRef.current = source;

				if (typeof ctx.audioWorklet !== "undefined") {
					try {
						const blobUrl = URL.createObjectURL(
							new Blob([WORKLET_CODE], { type: "application/javascript" }),
						);
						await ctx.audioWorklet.addModule(blobUrl);
						URL.revokeObjectURL(blobUrl);
						const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
						worklet.port.onmessage = (e) => sendPcm(e.data as Float32Array);
						source.connect(worklet);
						worklet.connect(ctx.destination);
						nodeRef.current = worklet;
					} catch {
						attachScriptProcessor(ctx, source, sendPcm, nodeRef);
					}
				} else {
					attachScriptProcessor(ctx, source, sendPcm, nodeRef);
				}

				setIsListening(true);
			})();
		});
	}, [settle, updatePartial]);

	const stopListening = useCallback(() => {
		setIsProcessing(true);
		setIsListening(false);
		if (streamRef.current) {
			for (const t of streamRef.current.getTracks()) t.stop();
		}
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "stop" }));
		} else {
			settle(partialRef.current);
		}
	}, [settle]);

	const cancelListening = useCallback(() => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "cancel" }));
		}
		updatePartial("");
		settle("");
	}, [settle, updatePartial]);

	useEffect(() => {
		return () => {
			settledRef.current = true;
			teardown();
			resolveRef.current = null;
		};
	}, [teardown]);

	return {
		available,
		isListening,
		isProcessing,
		partialText,
		startListening,
		stopListening,
		cancelListening,
	};
}

function attachScriptProcessor(
	ctx: AudioContext,
	source: MediaStreamAudioSourceNode,
	sendPcm: (frame: Float32Array) => void,
	nodeRef: React.MutableRefObject<AudioNode | null>,
) {
	const processor = ctx.createScriptProcessor(4096, 1, 1);
	processor.onaudioprocess = (e) => {
		sendPcm(e.inputBuffer.getChannelData(0));
	};
	source.connect(processor);
	processor.connect(ctx.destination);
	nodeRef.current = processor;
}
