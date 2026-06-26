import { api } from "@/api/client";

export interface VolcTTSRequest {
	text: string;
	record_id: number;
	voice_type?: string;
}

export class VolcTTSProvider {
	readonly providerName = "volcengine-tts";

	private abortController: AbortController | null = null;

	async synthesize(text: string, recordId: number): Promise<ArrayBuffer> {
		this.abortController?.abort();
		this.abortController = new AbortController();

		const response = await api.post<ArrayBuffer>(
			"/tts/synthesize",
			{ text, record_id: recordId } satisfies VolcTTSRequest,
			{
				responseType: "arraybuffer",
				signal: this.abortController.signal,
			},
		);

		this.abortController = null;
		return response.data;
	}

	cancel(): void {
		this.abortController?.abort();
		this.abortController = null;
	}
}
