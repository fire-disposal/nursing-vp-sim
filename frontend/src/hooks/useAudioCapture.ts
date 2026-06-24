import { useCallback, useRef } from "react";

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

interface AudioCaptureCallbacks {
	onFrame: (pcm: Int16Array) => void;
	onError: (err: string) => void;
}

interface AudioCaptureHandle {
	start: () => Promise<void>;
	stop: () => void;
}

/**
 * Manages microphone capture → AudioContext → PCM worklet/processor pipeline.
 * Returns start/stop controls. Audio frames are dispatched to onFrame callback.
 */
export function useAudioCapture(
	callbacks: AudioCaptureCallbacks,
): AudioCaptureHandle {
	const ctxRef = useRef<AudioContext | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const nodeRef = useRef<AudioNode | null>(null);
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;

	const teardown = useCallback(() => {
		try { nodeRef.current?.disconnect(); } catch { /* ignore */ }
		try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
		if (streamRef.current) {
			for (const t of streamRef.current.getTracks()) t.stop();
		}
		if (ctxRef.current && ctxRef.current.state !== "closed") {
			void ctxRef.current.close();
		}
		nodeRef.current = null;
		sourceRef.current = null;
		streamRef.current = null;
		ctxRef.current = null;
	}, []);

	const start = useCallback(async () => {
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, sampleRate: TARGET_RATE },
			});
		} catch {
			callbacksRef.current.onError("麦克风不可用");
			throw new Error("麦克风不可用");
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

		const source = ctx.createMediaStreamSource(stream);
		sourceRef.current = source;

		const sendPcm = (frame: Float32Array) => {
			callbacksRef.current.onFrame(downsampleToInt16(frame, inRate));
		};

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
				attachScriptProcessor(ctx, source, sendPcm);
			}
		} else {
			attachScriptProcessor(ctx, source, sendPcm);
		}
	}, []);

	const stop = useCallback(() => {
		if (streamRef.current) {
			for (const t of streamRef.current.getTracks()) t.stop();
		}
		teardown();
	}, [teardown]);

	return { start, stop };
}

function attachScriptProcessor(
	ctx: AudioContext,
	source: MediaStreamAudioSourceNode,
	sendPcm: (frame: Float32Array) => void,
) {
	const processor = ctx.createScriptProcessor(4096, 1, 1);
	processor.onaudioprocess = (e) => {
		sendPcm(e.inputBuffer.getChannelData(0));
	};
	source.connect(processor);
	processor.connect(ctx.destination);
}
