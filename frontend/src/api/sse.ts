export interface SSEHandlers {
	onChunk?: (text: string) => void;
	onDone?: (id?: number) => void;
	onError?: (msg: string) => void;
	onSystem?: (text: string) => void;
	onEmotionChange?: (data: { state: string; trust: number; comfort: number }) => void;
	onInitiative?: (data: { content: string }) => void;
	onExamResult?: (data: { type: string; data: Record<string, unknown> }) => void;
}

export async function readSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	handlers: SSEHandlers,
) {
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				try {
					const data = JSON.parse(line.slice(6));
					if (data.error) {
						handlers.onError?.(data.error);
						try { reader.cancel(); } catch { /* ignore */ }
						return;
					}
					if (data.system) { handlers.onSystem?.(data.system); continue; }
					if (data.exam_result) { handlers.onExamResult?.(data.exam_result); continue; }
					if (data.emotion_change) { handlers.onEmotionChange?.(data.emotion_change); continue; }
					if (data.initiative) { handlers.onInitiative?.(data.initiative); continue; }
					if (data.done) {
						handlers.onDone?.(data.id);
						try { reader.cancel(); } catch { /* ignore */ }
						return;
					}
					if (data.content) handlers.onChunk?.(data.content);
				} catch {
					/* ignore malformed SSE chunks */
				}
			}
		}
	} finally {
		try { reader.cancel(); } catch { /* ignore */ }
	}
}
