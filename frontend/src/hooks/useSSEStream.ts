import { useCallback, useEffect, useRef } from "react";

export interface SSEStreamOptions {
	url: string;
	token: string;
	onEvent?: (eventType: string, data: unknown) => void;
	onError?: (error: string) => void;
	onConnected?: () => void;
	reconnectBaseDelay?: number;
	reconnectMaxDelay?: number;
}

/**
 * Unified SSE stream hook — manages a ReadableStream SSE connection
 * with automatic reconnection (exponential backoff) and cleanup.
 *
 * Consumption pattern: provides an `onEvent` callback that receives
 * parsed event type + data pairs. Callers interpret the events.
 */
export function useSSEStream({
	url,
	token,
	onEvent,
	onError,
	onConnected,
	reconnectBaseDelay = 1000,
	reconnectMaxDelay = 30000,
}: SSEStreamOptions) {
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
	const abortedRef = useRef(false);
	const onEventRef = useRef(onEvent);
	const onErrorRef = useRef(onError);
	const onConnectedRef = useRef(onConnected);
	onEventRef.current = onEvent;
	onErrorRef.current = onError;
	onConnectedRef.current = onConnected;

	const cleanup = useCallback(() => {
		if (readerRef.current) {
			readerRef.current.cancel().catch(() => {});
			readerRef.current = null;
		}
		if (retryTimerRef.current) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}, []);

	const connect = useCallback(async () => {
		if (abortedRef.current) return;

		try {
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!response.ok) {
				if (response.status === 401) return;
				throw new Error(`HTTP ${response.status}`);
			}

			const stream = response.body;
			if (!stream) throw new Error("No response body");

			retryCountRef.current = 0;
			onConnectedRef.current?.();

			readerRef.current = stream.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (!abortedRef.current) {
				const { done, value } = await readerRef.current.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				let eventType = "";
				for (const line of lines) {
					if (line.startsWith("event: ")) {
						eventType = line.slice(7).trim();
					} else if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.slice(6));
							onEventRef.current?.(eventType, data);
						} catch (e) {
							console.warn("[SSE] malformed chunk:", e);
						}
					}
				}
			}
		} catch (err) {
			if (abortedRef.current) return;
			console.warn("[SSE] disconnected:", (err as Error)?.message);
			onErrorRef.current?.((err as Error)?.message || "SSE connection failed");
			const delay = Math.min(
				reconnectBaseDelay * 2 ** retryCountRef.current,
				reconnectMaxDelay,
			);
			retryCountRef.current = Math.min(retryCountRef.current + 1, 5);
			retryTimerRef.current = setTimeout(connect, delay);
		}
	}, [url, token, reconnectBaseDelay, reconnectMaxDelay]);

	useEffect(() => {
		abortedRef.current = false;
		connect();

		return () => {
			abortedRef.current = true;
			cleanup();
		};
	}, [connect, cleanup]);
}
