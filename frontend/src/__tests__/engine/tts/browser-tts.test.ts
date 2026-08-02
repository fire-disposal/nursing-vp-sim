import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserTTS } from "@/engine/tts/browser-tts";

class FakeUtterance {
	lang = "";
	rate = 1;
	pitch = 1;
	voice: unknown = null;
	onstart: (() => void) | null = null;
	onend: (() => void) | null = null;
	onerror: ((e: { error: string }) => void) | null = null;
}

const instances: FakeUtterance[] = [];

function installSpeechSynthesis() {
	const mock = {
		speak: vi.fn(),
		cancel: vi.fn(),
		getVoices: vi.fn<() => Array<{ lang: string }>>(() => []),
	};
	Object.defineProperty(window, "speechSynthesis", { value: mock, configurable: true });
	vi.stubGlobal(
		"SpeechSynthesisUtterance",
		class extends FakeUtterance {
			constructor(_text: string) {
				super();
				instances.push(this);
			}
		},
	);
	return { mock };
}

function latestUtterance(): FakeUtterance {
	const u = instances.at(-1);
	if (!u) throw new Error("没有创建 utterance");
	return u;
}

beforeEach(() => {
	vi.unstubAllGlobals();
	instances.length = 0;
	// @ts-expect-error 清理属性避免跨测试残留
	delete window.speechSynthesis;
});

describe("createBrowserTTS", () => {
	it("rejects when speechSynthesis unsupported", async () => {
		const tts = createBrowserTTS();
		await expect(tts.speak("你好")).rejects.toThrow("不支持语音合成");
	});

	it("speaks text with zh-CN lang", async () => {
		const { mock } = installSpeechSynthesis();
		const tts = createBrowserTTS();
		const promise = tts.speak("你好");
		expect(mock.speak).toHaveBeenCalled();
		const utterance = latestUtterance();
		expect(utterance.lang).toBe("zh-CN");
		utterance.onstart?.();
		expect(tts.speaking).toBe(true);
		utterance.onend?.();
		await expect(promise).resolves.toBeUndefined();
		expect(tts.speaking).toBe(false);
	});

	it("picks a Chinese voice when available", async () => {
		const { mock } = installSpeechSynthesis();
		const zh = { lang: "zh-CN" };
		mock.getVoices.mockReturnValue([zh]);
		const tts = createBrowserTTS();
		const promise = tts.speak("喂");
		expect(latestUtterance().voice).toBe(zh);
		latestUtterance().onend?.();
		await promise;
	});

	it("applies emotion rate and pitch", async () => {
		installSpeechSynthesis();
		const tts = createBrowserTTS();
		tts.emotion = "withdrawn";
		const promise = tts.speak("内容");
		const utterance = latestUtterance();
		expect(utterance.rate).toBe(0.85);
		expect(utterance.pitch).toBe(0.85);
		utterance.onend?.();
		await promise;
	});

	it("resolves on canceled error", async () => {
		installSpeechSynthesis();
		const tts = createBrowserTTS();
		const promise = tts.speak("内容");
		latestUtterance().onerror?.({ error: "canceled" });
		await expect(promise).resolves.toBeUndefined();
	});

	it("rejects on real synthesis error", async () => {
		installSpeechSynthesis();
		const tts = createBrowserTTS();
		const promise = tts.speak("内容");
		latestUtterance().onerror?.({ error: "synthesis-failed" });
		await expect(promise).rejects.toThrow("语音合成失败");
	});

	it("stop cancels and clears speaking", () => {
		const { mock } = installSpeechSynthesis();
		const tts = createBrowserTTS();
		tts.stop();
		expect(mock.cancel).toHaveBeenCalled();
		expect(tts.speaking).toBe(false);
	});

	it("exposes provider name", () => {
		const tts = createBrowserTTS();
		expect(tts.providerName).toBe("browser-speech-synthesis");
	});
});
