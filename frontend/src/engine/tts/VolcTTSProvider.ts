import useAuthStore from "@/stores/authStore";

export interface VolcTTSRequest {
	text: string;
	record_id: number;
	voice_type?: string;
}

/** Backend circuit breaker is open — caller should degrade the whole reply. */
export class TTSCircuitOpenError extends Error {}

export class VolcTTSProvider {
	readonly providerName = "volcengine-tts";

	/**
	 * Stream one sentence: POST /api/tts/stream and return the PCM byte
	 * stream. Throws TTSCircuitOpenError on 503, Error otherwise.
	 */
	async stream(
		text: string,
		recordId: number,
		signal: AbortSignal,
	): Promise<ReadableStream<Uint8Array>> {
		const token = useAuthStore.getState().token;
		const response = await fetch("/api/tts/stream", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({ text, record_id: recordId } satisfies VolcTTSRequest),
			signal,
		});
		if (response.status === 503) {
			throw new TTSCircuitOpenError("TTS service circuit open");
		}
		if (!response.ok) {
			throw new Error(`TTS stream failed: HTTP ${response.status}`);
		}
		if (!response.body) {
			throw new Error("TTS stream: empty response body");
		}
		return response.body;
	}
}
