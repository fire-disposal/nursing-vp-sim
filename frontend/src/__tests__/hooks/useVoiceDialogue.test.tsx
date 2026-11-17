import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsrProvider, AsrSession } from "@/engine/asr";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";

/**
 * `useVoiceDialogue` 的轮次编排：供应商事件 → 控制器 → onSend/onBargeIn。
 * 供应商是假的（不发 WS、不开麦克风），只验证 hook 的门：迟到事件、重复结果、空输入。
 */

interface ProviderHarness {
	provider: AsrProvider;
	sessions: AsrSession[];
}

function fakeProvider(create?: (session: AsrSession) => AsrSession): ProviderHarness {
	const sessions: AsrSession[] = [];
	const provider: AsrProvider = {
		id: "fake",
		supported: () => true,
		createSession: () => {
			const base: AsrSession = { turnDetection: true, start: vi.fn(), stop: vi.fn() };
			const session = create ? create(base) : base;
			sessions.push(session);
			return session;
		},
	};
	return { provider, sessions };
}

interface RenderOptions {
	patientReplying?: boolean;
	patientSpeaking?: boolean;
}

function renderVoice(primary: AsrProvider, fallback?: AsrProvider) {
	const onSend = vi.fn();
	const onBargeIn = vi.fn();
	const utils = renderHook(
		(options: RenderOptions) =>
			useVoiceDialogue({
				onSend,
				patientReplying: options.patientReplying ?? false,
				patientSpeaking: options.patientSpeaking ?? false,
				continuous: true,
				silenceMs: 800,
				asrProvider: primary,
				fallbackProvider: fallback,
				recordId: 42,
				token: "jwt",
				onBargeIn,
			}),
		{ initialProps: {} as RenderOptions },
	);
	return { ...utils, onSend, onBargeIn };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useVoiceDialogue 持续模式", () => {
	it("submits only the definite and only once", () => {
		const { provider, sessions } = fakeProvider();
		const { result, onSend } = renderVoice(provider);
		act(() => result.current.start());
		act(() => {
			sessions[0].onSpeechStart?.();
			sessions[0].onPartial?.("你哪里");
			sessions[0].onDefinite?.("你哪里不舒服？");
			sessions[0].onDefinite?.("你哪里不舒服？");
		});
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith("你哪里不舒服？");
	});

	it("hides a guarded TTS echo from the live transcript", () => {
		const { provider, sessions } = fakeProvider();
		const { result } = renderHook(() =>
			useVoiceDialogue({
				onSend: vi.fn(),
				patientReplying: false,
				continuous: true,
				asrProvider: provider,
				recordId: 42,
				token: "jwt",
				transcriptGuard: (text) => text.includes("患者"),
			}),
		);
		act(() => result.current.start());
		act(() => sessions[0].onPartial?.("患者刚才说的话"));
		expect(result.current.transcript).toBe("");
		act(() => sessions[0].onPartial?.("我想问哪里不舒服"));
		expect(result.current.transcript).toBe("我想问哪里不舒服");
	});

	it("does not send empty definite output", () => {
		const { provider, sessions } = fakeProvider();
		const { result, onSend } = renderVoice(provider);
		act(() => result.current.start());
		act(() => sessions[0].onDefinite?.(""));
		act(() => sessions[0].onDefinite?.("   "));
		expect(onSend).not.toHaveBeenCalled();
	});

	it("drops events from the previous session after a restart", () => {
		const { provider, sessions } = fakeProvider();
		const { result, onSend } = renderVoice(provider);
		act(() => result.current.start());
		const first = sessions[0];
		// 关麦再开：新会话取代旧会话
		act(() => result.current.stop());
		act(() => result.current.start());
		const second = sessions.at(-1) as AsrSession;
		expect(second).not.toBe(first);
		act(() => first.onDefinite?.("旧会话的一句话"));
		expect(onSend).not.toHaveBeenCalled();
		act(() => second.onDefinite?.("新会话的一句话"));
		expect(onSend).toHaveBeenCalledTimes(1);
	});

	it("waits for the real speech start before barging in", () => {
		const { provider, sessions } = fakeProvider();
		const { result, onBargeIn } = renderVoice(provider);
		act(() => result.current.start());
		act(() => sessions[0].onSpeechStart?.());
		expect(onBargeIn).not.toHaveBeenCalled();
		expect(sessions[0].onSpeechRealStart).toBeDefined();
	});

	it("falls back to the browser provider when the cloud ASR is disabled (4401)", () => {
		const { provider, sessions } = fakeProvider();
		const fallback = fakeProvider();
		const { result, onSend } = renderVoice(provider, fallback.provider);
		act(() => result.current.start());
		expect(sessions.length).toBe(1);
		act(() => {
			sessions[0].onError?.("disabled");
		});
		expect(result.current.basicVoiceMode).toBe(true);
		expect(result.current.notice).toBeTruthy();
		expect(fallback.sessions.length).toBe(1);
		expect(onSend).not.toHaveBeenCalled();
	});
});
