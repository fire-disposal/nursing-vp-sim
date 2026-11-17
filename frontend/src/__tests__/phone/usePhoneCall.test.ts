import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoHistoryMessage } from "@/engine/phone/chat";
import type { DemoTTSPlayer } from "@/engine/phone/ttsPlayer";
import { usePhoneCall } from "@/engine/phone/usePhoneCall";
import type { UseVoiceDialogueOptions, UseVoiceDialogueResult } from "@/hooks/useVoiceDialogue";

/**
 * 电话运行时：ASR 走 demo（recordId=0）、回复走注入的 SSE（不调真实模型）、
 * TTS 走注入的假播放器。全程不开麦、不发网络请求。
 */

interface FakeVoice {
	harness: { calls: UseVoiceDialogueOptions[]; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
	hook: (options: UseVoiceDialogueOptions) => UseVoiceDialogueResult;
}

function fakeVoice(overrides: Partial<UseVoiceDialogueResult> = {}): FakeVoice {
	const calls: UseVoiceDialogueOptions[] = [];
	const start = vi.fn();
	const stop = vi.fn();
	return {
		harness: { calls, start, stop },
		hook: (options) => {
			calls.push(options);
			return {
				phase: "idle",
				transcript: "",
				supported: true,
				speechActive: false,
				notice: null,
				continuousArmed: false,
				continuousFailed: false,
				interrupted: false,
				basicVoiceMode: false,
				start,
				stop,
				pressStart: vi.fn(),
				pressEnd: vi.fn(),
				reset: vi.fn(),
				...overrides,
			};
		},
	};
}

function fakePlayer() {
	const listeners = new Set<Parameters<DemoTTSPlayer["subscribe"]>[0]>();
	const spoken: string[] = [];
	let stopCalls = 0;
	const player = {
		speak: vi.fn(async (text: string) => {
			spoken.push(text);
			for (const fn of listeners) fn({ type: "first-block", ms: 120, fallback: false });
		}),
		finish: vi.fn(async () => undefined),
		waitIdle: vi.fn(async () => undefined),
		stop: vi.fn(() => {
			stopCalls += 1;
			for (const fn of listeners) fn({ type: "stopped" });
		}),
		subscribe: vi.fn((fn: Parameters<DemoTTSPlayer["subscribe"]>[0]) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}),
		setContext: vi.fn(),
		prime: vi.fn(async () => undefined),
		dispose: vi.fn(),
		get meta() {
			return { emotion: "relaxed", voice: "zh_male_y", sampleRate: 24000 };
		},
	} as unknown as DemoTTSPlayer;
	return { player, spoken, stopCalls: () => stopCalls };
}

/** 可控的 SSE：测试里手动推文本块 / 收尾。 */
function controllableChat() {
	const turns: Array<{ chunk: (text: string) => void; done: () => void }> = [];
	const streamChat = vi.fn(
		(_turn: unknown, options: { onChunk?: (t: string) => void; onDone?: () => void; signal?: AbortSignal }) => {
			let settle: (value: string) => void = () => undefined;
			const promise = new Promise<string>((resolve) => {
				settle = resolve;
			});
			let full = "";
			turns.push({
				chunk: (text) => {
					full += text;
					options.onChunk?.(text);
				},
				done: () => {
					options.onDone?.();
					settle(full);
				},
			});
			return promise;
		},
	);
	return { streamChat, turns };
}

function renderCall(characterId: string | null, voiceOverrides: Partial<UseVoiceDialogueResult> = {}) {
	const voice = fakeVoice(voiceOverrides);
	const tts = fakePlayer();
	const chat = controllableChat();
	const utils = renderHook(() =>
		usePhoneCall({
			characterId,
			voiceHook: voice.hook,
			playerFactory: () => tts.player,
			streamChat: chat.streamChat as never,
		}),
	);
	return { ...utils, voice, tts, chat };
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("与训练链路无关", () => {
	it("ASR 用 recordId=0 走 demo 路径，并且是持续对谈", () => {
		const { result, voice } = renderCall("lin-wanqing");
		act(() => result.current.startCall());
		const call = voice.harness.calls.at(-1);
		expect(call?.recordId).toBe(0);
		expect(call?.continuous).toBe(true);
		expect(voice.harness.start).toHaveBeenCalledTimes(1);
	});

	it("开始通话播固定开场白，不等模型", () => {
		const { result, tts, chat } = renderCall("zhou-zhenguo");
		act(() => result.current.startCall());
		expect(result.current.stage).toBe("greeting");
		expect(tts.spoken[0]).toContain("周建国");
		expect(chat.streamChat).not.toHaveBeenCalled();
	});

	it("drops an opening-line echo prefix before it reaches the model", () => {
		const { result, voice, chat } = renderCall("lin-wanqing");
		act(() => result.current.startCall());
		const send = voice.harness.calls.at(-1)?.onSend;
		act(() => send?.("喂，我这边几"));
		expect(result.current.lines.some((line) => line.role === "user")).toBe(false);
		expect(chat.streamChat).not.toHaveBeenCalled();
	});
});

describe("handleUserText → LLM 流 → TTS", () => {
	it("请求带角色、当前情绪与短历史，文本块进气泡与 TTS 队列", async () => {
		const { result, tts, chat } = renderCall("su-xiaoman");
		act(() => result.current.handleUserText("你好呀"));
		const first = chat.streamChat.mock.calls[0][0] as {
			character_id: string;
			history: DemoHistoryMessage[];
			emotion_state: string;
		};
		expect(first.character_id).toBe("su-xiaoman");
		expect(first.emotion_state).toBeTruthy();
		expect(first.history).toEqual([{ role: "student", content: "你好呀" }]);

		await act(async () => {
			chat.turns[0].chunk("我在呢，");
			chat.turns[0].chunk("你说。");
		});
		expect(tts.spoken).toEqual(["我在呢，", "你说。"]);
		const patient = result.current.lines.filter((l) => l.role === "patient").at(-1);
		expect(patient?.text).toBe("我在呢，你说。");

		await act(async () => {
			chat.turns[0].done();
			await Promise.resolve();
		});
		expect(result.current.metrics.firstTokenMs).not.toBeNull();

		// 第二轮带上刚才的一问一答
		act(() => result.current.handleUserText("那明天见？"));
		const second = chat.streamChat.mock.calls[1][0] as { history: DemoHistoryMessage[] };
		expect(second.history).toEqual([
			{ role: "student", content: "你好呀" },
			{ role: "patient", content: "我在呢，你说。" },
			{ role: "student", content: "那明天见？" },
		]);
	});

	it("长回复用例传 test_mode=long_response", () => {
		const { result, chat } = renderCall("lin-wanqing");
		act(() => result.current.runQuickTest("interrupt"));
		const turn = chat.streamChat.mock.calls[0][0] as { test_mode?: string };
		expect(turn.test_mode).toBe("long_response");
	});

	it("问候与问情绪走普通请求（无 test_mode）", () => {
		const { result, chat } = renderCall("lin-wanqing");
		act(() => result.current.runQuickTest("greeting"));
		act(() => result.current.runQuickTest("emotion"));
		for (const [turn] of chat.streamChat.mock.calls) {
			expect(turn as { test_mode?: string }).not.toHaveProperty("test_mode");
		}
		expect(chat.streamChat).toHaveBeenCalledTimes(2);
	});

	it("学生消息改变四维向量并给出标签", () => {
		const { result } = renderCall("he-jianfeng");
		const before = result.current.emotion.trust;
		act(() => result.current.handleUserText("我理解你，不着急，慢慢说"));
		expect(result.current.emotion.trust).toBeGreaterThan(before);
		expect(result.current.lines[0].role).toBe("user");
	});
});

describe("打断", () => {
	it("有效打断：abort 在途生成、停播、标记消息、记录停播延迟", async () => {
		const { result, tts, voice, chat } = renderCall("lin-wanqing");
		act(() => result.current.startCall());
		act(() => result.current.handleUserText("你详细说说"));
		await act(async () => {
			chat.turns[0].chunk("这件事说起来话就长了，");
		});
		const onBargeIn = voice.harness.calls.at(-1)?.onBargeIn;
		act(() => onBargeIn?.());
		expect(tts.stopCalls()).toBeGreaterThan(0);
		expect(result.current.metrics.stopMs).not.toBeNull();
		expect(result.current.lines.some((l) => l.interrupted)).toBe(true);
		// 打断后旧轮的迟到帧不再改变气泡
		const textAfter = result.current.lines.at(-1)?.text;
		await act(async () => {
			chat.turns[0].chunk("迟到的内容");
		});
		expect(result.current.lines.at(-1)?.text).toBe(textAfter);
	});

	it("停止通话：阶段 ended、关麦、停播", () => {
		const { result, tts, voice } = renderCall("he-jianfeng");
		act(() => result.current.startCall());
		act(() => result.current.stopCall());
		expect(result.current.stage).toBe("ended");
		expect(voice.harness.stop).toHaveBeenCalled();
		expect(tts.stopCalls()).toBeGreaterThan(0);
		expect(result.current.dialed).toBe(false);
	});
});
