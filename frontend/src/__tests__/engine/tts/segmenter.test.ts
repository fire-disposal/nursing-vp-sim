import { describe, expect, it } from "vitest";
import { MAX_TTS_LENGTH, SentenceSegmenter, cleanTTSText } from "@/engine/tts/segmenter";

describe("cleanTTSText", () => {
	it("strips markdown bold and italics", () => {
		expect(cleanTTSText("**重要**内容")).toBe("重要内容");
		expect(cleanTTSText("*斜体*")).toBe("斜体");
	});

	it("strips bracketed annotations", () => {
		expect(cleanTTSText("好的[叹气]")).toBe("好的");
	});

	it("collapses newlines into sentence breaks", () => {
		expect(cleanTTSText("第一行\n\n第二行")).toBe("第一行。第二行");
		expect(cleanTTSText("a\nb")).toBe("ab");
	});

	it("trims whitespace", () => {
		expect(cleanTTSText("  内容  ")).toBe("内容");
	});
});

describe("parenthetical asides are not synthesized", () => {
	it("drops a full-width aside inside a sentence", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("好的（叹气），我这就说。")).toEqual(["好的，我这就说。"]);
	});

	it("drops an aside that starts the sentence", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("（皱眉按着下腹）你们又来了。")).toEqual(["你们又来了。"]);
	});

	it("keeps the text before the aside and drops only the aside", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("我（沉默")).toEqual([]);
		expect(seg.push("几秒）有点紧张。")).toEqual(["我有点紧张。"]);
	});

	it("does not break sentences on punctuation inside an aside", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("（沉默。几秒）说实话吧。")).toEqual(["说实话吧。"]);
	});

	it("handles half-width parentheses", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("(sigh)我很难受。")).toEqual(["我很难受。"]);
	});

	it("counts the sentence total without the aside", () => {
		const seg = new SentenceSegmenter(6);
		expect(seg.push("你好（叹气）啊。")).toEqual(["你好啊。"]);
		expect(seg.exhausted).toBe(false);
	});

	it("treats an over-long unclosed bracket as speech", () => {
		const seg = new SentenceSegmenter();
		const out = seg.push(`（${"说".repeat(60)}。`);
		expect(out.join("")).toContain("说");
		expect(out.join("")).not.toContain("（");
	});

	it("drops a truncated trailing aside on flush", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("好的（叹气")).toEqual([]);
		expect(seg.flush()).toEqual(["好的"]);
	});

	it("clears aside state on reset", () => {
		const seg = new SentenceSegmenter();
		seg.push("我（沉默");
		seg.reset();
		expect(seg.push("好的。")).toEqual(["好的。"]);
	});
});

describe("SentenceSegmenter", () => {
	it("extracts complete sentences on punctuation", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("你好，")).toEqual([]);
		expect(seg.push("我有点担心。")).toEqual(["你好，我有点担心。"]);
	});

	it("holds incomplete sentences until boundary", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("第一句")).toEqual([]);
		expect(seg.push("？")).toEqual(["第一句？"]);
	});

	it("flush returns remaining buffer", () => {
		const seg = new SentenceSegmenter();
		seg.push("没有标点");
		expect(seg.flush()).toEqual(["没有标点"]);
	});

	it("flush with empty buffer returns nothing", () => {
		const seg = new SentenceSegmenter();
		expect(seg.flush()).toEqual([]);
	});

	it("drops sentences shorter than minimum", () => {
		const seg = new SentenceSegmenter();
		seg.push("好");
		expect(seg.flush()).toEqual([]);
	});

	it("carries short fragments into the next sentence", () => {
		const seg = new SentenceSegmenter();
		expect(seg.push("。")).toEqual([]); // 单字符片段暂存
		expect(seg.push("好。")).toEqual(["。好。"]); // 与下一句拼接后输出
	});

	it("respects max total length", () => {
		const seg = new SentenceSegmenter(10);
		const out = seg.push("这是一段超过十个字的完整句子。");
		expect(seg.exhausted).toBe(true);
		expect(out[0].length).toBe(10);
		expect(seg.push("更多内容。")).toEqual([]);
	});

	it("exhausted after limit stops all extraction", () => {
		const seg = new SentenceSegmenter(5);
		seg.push("abcde。");
		expect(seg.exhausted).toBe(true);
		expect(seg.flush()).toEqual([]);
	});

	it("reset clears state", () => {
		const seg = new SentenceSegmenter(5);
		seg.push("abcde。");
		seg.reset();
		expect(seg.exhausted).toBe(false);
		expect(seg.push("新句子。")).toEqual(["新句子。"]);
	});

	it("splits long buffers at soft breaks", () => {
		const seg = new SentenceSegmenter();
		const long = "病人在诉说不适，".repeat(20); // 无句号，仅逗号，长度 180 > 100
		const out = seg.push(long);
		expect(out.length).toBeGreaterThan(0);
		for (const s of out) {
			expect(s.length).toBeLessThanOrEqual(100);
		}
	});

	it("default max total length constant", () => {
		expect(MAX_TTS_LENGTH).toBe(500);
	});
});
