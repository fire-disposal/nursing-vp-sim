import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageBus } from "@/engine/MessageBus";
import { TTSManager } from "@/engine/tts/TTSManager";

class FakeUtterance {
	lang = "";
	rate = 1;
	pitch = 1;
	voice: SpeechSynthesisVoice | null = null;
	onstart: (() => void) | null = null;
	onend: (() => void) | null = null;
	onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

	constructor(readonly text: string) {}
}

let browserSpeechDescriptors: {
	speechSynthesis?: PropertyDescriptor;
	utterance?: PropertyDescriptor;
} | null = null;

function installBrowserSpeech() {
	const utterances: FakeUtterance[] = [];
	const speech = {
		cancel: vi.fn(),
		getVoices: vi.fn(() => []),
		speak: vi.fn((utterance: FakeUtterance) => {
			utterances.push(utterance);
			utterance.onstart?.();
		}),
	};
	browserSpeechDescriptors = {
		speechSynthesis: Object.getOwnPropertyDescriptor(window, "speechSynthesis"),
		utterance: Object.getOwnPropertyDescriptor(window, "SpeechSynthesisUtterance"),
	};
	Object.defineProperty(window, "speechSynthesis", {
		configurable: true,
		value: speech,
	});
	Object.defineProperty(window, "SpeechSynthesisUtterance", {
		configurable: true,
		value: FakeUtterance,
	});
	return { utterances };
}

afterEach(() => {
	vi.restoreAllMocks();
	const descriptors = browserSpeechDescriptors;
	if (!descriptors) return;
	if (descriptors.speechSynthesis) {
		Object.defineProperty(window, "speechSynthesis", descriptors.speechSynthesis);
	} else {
		Reflect.deleteProperty(window, "speechSynthesis");
	}
	if (descriptors.utterance) {
		Object.defineProperty(window, "SpeechSynthesisUtterance", descriptors.utterance);
	} else {
		Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
	}
	browserSpeechDescriptors = null;
});

describe("TTSManager stream lifecycle", () => {
	it("drains a partial reply after SSE error and releases the active TTS state", async () => {
		const { utterances } = installBrowserSpeech();
		const bus = createMessageBus();
		const manager = new TTSManager({ autoPlay: true });
		const ended = vi.fn();
		bus.on("tts:end", ended);
		manager.attach(bus);

		bus.emit("chat:beforeSend");
		bus.emit("stream:chunk", "患者您好。");
		await vi.waitFor(() => expect(utterances).toHaveLength(1));
		bus.emit("stream:error", "网络中断");
		utterances[0]?.onend?.();

		await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
		manager.detach();
	});

	it("stopping an active reply emits one terminal event instead of leaving dependent UI paused", async () => {
		const { utterances } = installBrowserSpeech();
		const bus = createMessageBus();
		const manager = new TTSManager({ autoPlay: true });
		const ended = vi.fn();
		bus.on("tts:end", ended);
		manager.attach(bus);

		bus.emit("chat:beforeSend");
		bus.emit("stream:chunk", "请您深呼吸。");
		await vi.waitFor(() => expect(utterances).toHaveLength(1));
		manager.stop();

		expect(ended).toHaveBeenCalledTimes(1);
		manager.detach();
		expect(ended).toHaveBeenCalledTimes(1);
	});
});
