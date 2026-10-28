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
/** 括号旁白（神态/动作）：只出现在字幕里，不进合成。新旧全半角都算。 */
const ASIDE_OPEN = /[（(]/;
const ASIDE_CLOSE = /[）)]/;
/** 旁白最长容忍：超过它仍未收尾，说明不是旁白，当台词说（防一个残括号吃掉整段回复）。 */
const MAX_ASIDE = 40;

export function cleanTTSText(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/\[.*?\]/g, "")
		// 旁白已在切片阶段整段丢弃，残留的右括号只可能是未配对残片
		.replace(/[）)]/g, "")
		.replace(/\n{2,}/g, "。")
		.replace(/\n/g, "")
		.trim();
}

export class SentenceSegmenter {
	private buf = "";
	private pending = "";
	private dispatched = 0;
	/** 当前切片点在一个未收尾的括号旁白里（跨 chunk / 跨句都靠它续上）。 */
	private inAside = false;
	/** 旁白内已收到的内容：与 `buf`（要说出口的文本）分开，收尾时整段丢掉。 */
	private aside = "";

	constructor(private maxTotal = MAX_TTS_LENGTH) {}

	get exhausted(): boolean {
		return this.dispatched >= this.maxTotal;
	}

	push(chunk: string): string[] {
		if (this.exhausted) return [];
		if (this.inAside) this.aside += chunk;
		else this.buf += chunk;
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
		this.inAside = false;
		this.aside = "";
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
			// 括号旁白整段丢弃：不合成、也不让它内部的句号参与断句。
			if (this.inAside) {
				const close = this.aside.search(ASIDE_CLOSE);
				if (close >= 0) {
					this.buf += this.aside.slice(close + 1);
					this.aside = "";
					this.inAside = false;
					continue;
				}
				if (this.aside.length > MAX_ASIDE) {
					// 长到不像旁白：当作台词说，别让一个残括号吃掉后半段回复
					this.buf += this.aside;
					this.aside = "";
					this.inAside = false;
					continue;
				}
				if (flushAll) {
					// 回复被截断（括号没收尾）：丢掉残旁白，保留它前面已说出口的部分
					this.aside = "";
					this.inAside = false;
				}
				break;
			}
			const m = this.buf.match(SENTENCE_END);
			const open = this.buf.match(ASIDE_OPEN);
			if (open && open.index !== undefined && (!m || m.index === undefined || open.index < m.index)) {
				this.aside = this.buf.slice(open.index + 1);
				this.buf = this.buf.slice(0, open.index);
				this.inAside = true;
				continue;
			}
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
