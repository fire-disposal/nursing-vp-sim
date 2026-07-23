/**
 * SentenceSegmenter — accumulates LLM stream chunks and extracts complete
 * sentences the moment a boundary appears, so TTS synthesis can start on the
 * first sentence instead of waiting for the full reply.
 */

export const MAX_TTS_LENGTH = 500;

const SENTENCE_END = /[。！？!?；;\n]/;
const MAX_SENTENCE = 100;
const MIN_SENTENCE = 2;
const SOFT_BREAK = /[，,、]/;

export function cleanTTSText(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/\[.*?\]/g, "")
		.replace(/\n{2,}/g, "。")
		.replace(/\n/g, "")
		.trim();
}

export class SentenceSegmenter {
	private buf = "";
	private pending = "";
	private dispatched = 0;

	constructor(private maxTotal = MAX_TTS_LENGTH) {}

	get exhausted(): boolean {
		return this.dispatched >= this.maxTotal;
	}

	push(chunk: string): string[] {
		if (this.exhausted) return [];
		this.buf += chunk;
		return this.extract(false);
	}

	flush(): string[] {
		if (this.exhausted) return [];
		return this.extract(true);
	}

	reset(): void {
		this.buf = "";
		this.pending = "";
		this.dispatched = 0;
	}

	private take(sentence: string, out: string[]): void {
		const cleaned = this.pending + cleanTTSText(sentence);
		if (cleaned.length < MIN_SENTENCE) {
			// Too short to synthesize alone — carry into the next sentence.
			this.pending = cleaned;
			return;
		}
		this.pending = "";
		const room = this.maxTotal - this.dispatched;
		if (room <= 0) return;
		const final = cleaned.length > room ? cleaned.slice(0, room) : cleaned;
		this.dispatched += final.length;
		out.push(final);
	}

	private extract(flushAll: boolean): string[] {
		const out: string[] = [];
		for (;;) {
			const m = this.buf.match(SENTENCE_END);
			if (m && m.index !== undefined) {
				const end = m.index + 1;
				const sentence = this.buf.slice(0, end);
				this.buf = this.buf.slice(end);
				this.take(sentence, out);
				continue;
			}
			// No boundary: force-cut an over-long buffer at the last soft break.
			if (!flushAll && this.buf.length > MAX_SENTENCE) {
				const window = this.buf.slice(0, MAX_SENTENCE);
				let cut = -1;
				for (let i = window.length - 1; i >= 0; i--) {
					if (SOFT_BREAK.test(window[i])) {
						cut = i + 1;
						break;
					}
				}
				if (cut < MIN_SENTENCE) cut = MAX_SENTENCE;
				const sentence = this.buf.slice(0, cut);
				this.buf = this.buf.slice(cut);
				this.take(sentence, out);
				continue;
			}
			break;
		}
		if (flushAll && this.buf) {
			const rest = this.buf;
			this.buf = "";
			this.take(rest, out);
		}
		return out;
	}
}
