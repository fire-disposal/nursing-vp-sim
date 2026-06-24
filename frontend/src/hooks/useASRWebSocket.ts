import { useCallback, useRef } from "react";
import useAuthStore from "@/stores/authStore";
import type { Int16Array } from "type-fest";

interface ServerMsg {
	type: "partial" | "final" | "error" | "unavailable";
	text?: string;
	confidence?: number;
}

interface ASRCallbacks {
	onPartial: (text: string) => void;
	onFinal: (text: string) => void;
	onUnavailable: () => void;
	onError: () => void;
}

function buildWsUrl(): string {
	const token = useAuthStore.getState().token ?? "";
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/api/asr/stream?token=${encodeURIComponent(token)}`;
}

/**
 * Manages a WebSocket connection to the ASR server.
 * Provides sendPcm() to push audio frames and controls for stop/cancel.
 */
export function useASRWebSocket(callbacks: ASRCallbacks) {
	const wsRef = useRef<WebSocket | null>(null);
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;

	const connect = useCallback(() => {
		return new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(buildWsUrl());
			ws.binaryType = "arraybuffer";
			wsRef.current = ws;

			ws.onopen = () => resolve();
			ws.onmessage = (ev) => {
				let msg: ServerMsg;
				try {
					msg = JSON.parse(ev.data as string) as ServerMsg;
				} catch {
					return;
				}
				if (msg.type === "partial") {
					callbacksRef.current.onPartial(msg.text ?? "");
				} else if (msg.type === "final") {
					callbacksRef.current.onFinal(msg.text ?? "");
				} else if (msg.type === "unavailable") {
					callbacksRef.current.onUnavailable();
				} else if (msg.type === "error") {
					callbacksRef.current.onError();
				}
			};
			ws.onerror = () => {
				callbacksRef.current.onError();
				reject(new Error("WebSocket error"));
			};
			ws.onclose = () => {
				callbacksRef.current.onError();
			};
		});
	}, []);

	const sendPcm = useCallback((pcm: Int16Array) => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(pcm.buffer);
		}
	}, []);

	const sendStop = useCallback(() => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "stop" }));
		}
	}, []);

	const sendCancel = useCallback(() => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "cancel" }));
		}
	}, []);

	const close = useCallback(() => {
		const ws = wsRef.current;
		if (ws && ws.readyState <= WebSocket.OPEN) {
			ws.close();
		}
		wsRef.current = null;
	}, []);

	return { connect, sendPcm, sendStop, sendCancel, close };
}
