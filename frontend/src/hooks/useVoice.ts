import { useCallback, useEffect, useRef, useState } from "react";
import { fetchASRStatus } from "@/api/admin/voice-cost";
import { useASRWebSocket } from "@/hooks/useASRWebSocket";
import { useAudioCapture } from "@/hooks/useAudioCapture";

export interface UseVoiceReturn {
	available: boolean;
	isListening: boolean;
	isProcessing: boolean;
	partialText: string;
	startListening: () => Promise<string>;
	stopListening: () => void;
	cancelListening: () => void;
}

/**
 * Thin orchestrator — delegates hardware (useAudioCapture) and
 * network (useASRWebSocket) to focused hooks.
 *
 * useVoice only manages state orchestration and the resolve/settle
 * promise for the startListening() callers.
 */
export default function useVoice(): UseVoiceReturn {
	const [available, setAvailable] = useState(true);
	const [isListening, setIsListening] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [partialText, setPartialText] = useState("");

	const resolveRef = useRef<((text: string) => void) | null>(null);
	const partialRef = useRef("");
	const settledRef = useRef(false);
	const listeningRef = useRef(false);

	const updatePartial = useCallback((text: string) => {
		partialRef.current = text;
		setPartialText(text);
	}, []);

	const settle = useCallback(
		(text: string) => {
			if (settledRef.current) return;
			settledRef.current = true;
			setIsListening(false);
			setIsProcessing(false);
			listeningRef.current = false;
			wsHook.close();
			audioHook.stop();
			resolveRef.current?.(text);
			resolveRef.current = null;
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	const wsHook = useASRWebSocket({
		onPartial: (text) => updatePartial(text),
		onFinal: (text) => {
			updatePartial(text);
			settle(text);
		},
		onUnavailable: () => {
			setAvailable(false);
			settle("");
		},
		onError: () => settle(partialRef.current),
	});

	const audioHook = useAudioCapture({
		onFrame: (pcm) => wsHook.sendPcm(pcm),
		onError: () => settle(partialRef.current),
	});

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

	const startListening = useCallback((): Promise<string> => {
		return new Promise((resolve, reject) => {
			if (listeningRef.current) {
				reject(new Error("already listening"));
				return;
			}
			settledRef.current = false;
			resolveRef.current = resolve;
			updatePartial("");
			listeningRef.current = true;

			audioHook
				.start()
				.then(() => wsHook.connect())
				.then(() => setIsListening(true))
				.catch((err) => {
					settledRef.current = true;
					listeningRef.current = false;
					audioHook.stop();
					resolveRef.current = null;
					reject(err instanceof Error ? err : new Error("语音识别启动失败"));
				});
		});
	}, [audioHook, wsHook, updatePartial]);

	const stopListening = useCallback(() => {
		setIsProcessing(true);
		setIsListening(false);
		wsHook.sendStop();
		audioHook.stop();
	}, [wsHook, audioHook]);

	const cancelListening = useCallback(() => {
		wsHook.sendCancel();
		updatePartial("");
		settle("");
	}, [wsHook, updatePartial, settle]);

	useEffect(() => {
		return () => {
			settledRef.current = true;
			wsHook.close();
			audioHook.stop();
			resolveRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
