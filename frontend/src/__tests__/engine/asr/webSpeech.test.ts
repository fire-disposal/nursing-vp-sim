import { afterEach, describe, expect, it, vi } from "vitest";
import { webSpeechAsrProvider } from "@/engine/asr/webSpeech";

type Rec = {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	onresult:
		| ((e: { results: ArrayLike<{ isFinal: boolean; length: number; [i: number]: { transcript: string } }> }) => void)
		| null;
	onend: (() => void) | null;
	onerror: ((e?: { error?: string }) => void) | null;
};

function makeRec(): Rec {
	const rec: Rec = {
		lang: "",
		interimResults: false,
		continuous: false,
		start: vi.fn(),
		stop: vi.fn(),
		onresult: null,
		onend: null,
		onerror: null,
	};
	vi.stubGlobal("webkitSpeechRecognition", function WebkitSR() { return rec; });
	return rec;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("webSpeechAsrProvider", () => {
	it("无全局可用时 supported()=false，有则 true", () => {
		expect(webSpeechAsrProvider.supported()).toBe(false);
		vi.stubGlobal("webkitSpeechRecognition", function WebkitSR() { return {}; });
		expect(webSpeechAsrProvider.supported()).toBe(true);
	});

	it("createSession 归一化事件：累加转写 + final 标志 + start/stop/onend 透传", () => {
		const rec = makeRec();
		const session = webSpeechAsrProvider.createSession({ lang: "zh-CN", interimResults: true });

		let result: { transcript: string; final: boolean } | null = null;
		session.onresult = (r) => {
			result = r;
		};
		const onEnd = vi.fn();
		const onError = vi.fn();
		session.onend = onEnd;
		session.onerror = onError;

		session.start();
		expect(rec.start).toHaveBeenCalled();
		expect(rec.lang).toBe("zh-CN");
		expect(rec.interimResults).toBe(true);

		// 单段未 final：results[i] 为 SpeechRecognitionResult（含 isFinal + 替换数组下标）。
		const seg = (transcript: string, isFinal: boolean) => ({ isFinal, length: 1, 0: { transcript } });
		rec.onresult?.({ results: [seg("头疼", false)] });
		expect(result).toEqual({ transcript: "头疼", final: false });

		// 多段 final。
		rec.onresult?.({ results: [seg("头疼", true), seg(" 三天", true)] });
		expect(result).toEqual({ transcript: "头疼 三天", final: true });

		rec.onend?.();
		expect(onEnd).toHaveBeenCalled();

		rec.onerror?.();
		expect(onError).toHaveBeenCalled();
	});

	it("透传 continuous 选项；错误码原样上报（持续聆听要区分 not-allowed 与 no-speech）", () => {
		const rec = makeRec();
		const session = webSpeechAsrProvider.createSession({ continuous: true, interimResults: true });
		session.start();
		expect(rec.continuous).toBe(true);
		expect(rec.interimResults).toBe(true);

		const onError = vi.fn();
		session.onerror = onError;
		rec.onerror?.({ error: "not-allowed" });
		expect(onError).toHaveBeenCalledWith("not-allowed");

		rec.onerror?.({ error: "no-speech" });
		expect(onError).toHaveBeenLastCalledWith("no-speech");

		// 无码事件仍有一个稳定兜底值（调用方不必猜 undefined）
		rec.onerror?.();
		expect(onError).toHaveBeenLastCalledWith("recognition_failed");
	});
});
