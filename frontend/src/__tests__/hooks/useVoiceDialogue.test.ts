import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AsrProvider, AsrSession } from "@/engine/asr";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";

type Rec = {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
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
	vi.useRealTimers();
});

describe("useVoiceDialogue（半双工语音对答状态机）", () => {
	it("浏览器不支持 → supported=false，start 给出提示", () => {
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend: vi.fn(), patientReplying: false }),
		);
		expect(result.current.supported).toBe(false);
		act(() => result.current.start());
		expect(result.current.notice).toContain("不支持");
	});

	it("start → listening；说完 onend 自动发送", () => {
		const rec = makeRec();
		const onSend = vi.fn();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false }),
		);
		expect(result.current.supported).toBe(true);

		act(() => result.current.start());
		expect(rec.start).toHaveBeenCalled();
		expect(result.current.phase).toBe("listening");

	act(() => {
		rec.onresult?.({ results: [[{ transcript: "我这两天喘不上气" }]] });
	});
	expect(result.current.transcript).toContain("喘不上气");
	act(() => rec.onend?.());
	expect(onSend).toHaveBeenCalledWith("我这两天喘不上气");
	expect(result.current.phase).toBe("sending");
	});

	it("聆听结束但无内容 → 没听清，不发送", () => {
		const rec = makeRec();
		const onSend = vi.fn();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false }),
		);
		act(() => result.current.start());
		act(() => rec.onend?.());
		expect(onSend).not.toHaveBeenCalled();
		expect(result.current.notice).toContain("没听清");
		expect(result.current.phase).toBe("idle");
	});

	it("patientReplying=true 时不能开始聆听（半双工，不抢话）", () => {
		const rec = makeRec();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend: vi.fn(), patientReplying: true }),
		);
		act(() => result.current.start());
		expect(rec.start).not.toHaveBeenCalled();
		expect(result.current.phase).not.toBe("listening");
	});

	it("患者回复结束（patientReplying false）→ 自动就绪 ready", () => {
		const rec = makeRec();
		const onSend = vi.fn();
		const { result, rerender } = renderHook(
			({ patientReplying }: { patientReplying: boolean }) =>
				useVoiceDialogue({ onSend, patientReplying }),
			{ initialProps: { patientReplying: false } },
		);
		act(() => result.current.start());
		act(() => {
			rec.onresult?.({ results: [[{ transcript: "疼痛" }]] });
			rec.onend?.();
		});
		expect(result.current.phase).toBe("sending");

		rerender({ patientReplying: true }); // 患者开始回复
		rerender({ patientReplying: false }); // 患者回复结束
		expect(result.current.phase).toBe("ready");
	});

	it("按住说话：pressStart → listening，pressEnd 立即自动发送", () => {
		const rec = makeRec();
		const onSend = vi.fn();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false }),
		);
		act(() => result.current.pressStart());
		act(() => {
			rec.onresult?.({ results: [[{ transcript: "咳嗽三天" }]] });
			result.current.pressEnd();
		});
		expect(onSend).toHaveBeenCalledWith("咳嗽三天");
	});

	it("识别出错 → 回退提示，不卡死", () => {
		const rec = makeRec();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend: vi.fn(), patientReplying: false }),
		);
		act(() => result.current.start());
		act(() => rec.onerror?.());
		expect(result.current.notice).toContain("识别失败");
		expect(result.current.phase).toBe("idle");
	});

	it("可注入自定义 ASR 供应商（未来在线 ASR 的替换点）", () => {
		const handlers = {
			onresult: null as ((r: { transcript: string; final: boolean }) => void) | null,
			onend: null as (() => void) | null,
			onerror: null as ((e: string) => void) | null,
		};
		const provider: AsrProvider = {
			id: "fake",
			supported: () => true,
			createSession: () => {
				const session: AsrSession = {
					start: vi.fn(),
					stop: vi.fn(),
					onresult: null,
					onend: null,
					onerror: null,
				};
				handlers.onresult = (r) => session.onresult?.(r);
				handlers.onend = () => session.onend?.();
				handlers.onerror = (e) => session.onerror?.(e);
				return session;
			},
		};
		const onSend = vi.fn();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false, asrProvider: provider }),
		);
		expect(result.current.supported).toBe(true);
		act(() => result.current.start());
		act(() => handlers.onresult?.({ transcript: "胸口闷", final: true }));
		act(() => handlers.onend?.());
		expect(onSend).toHaveBeenCalledWith("胸口闷");
		expect(result.current.phase).toBe("sending");
	});

	it("静音窗口到点自动发送（onend 未触发时兜底）", () => {
		const rec = makeRec();
		const onSend = vi.fn();
		vi.useFakeTimers();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false, silenceMs: 800 }),
		);
		act(() => result.current.start());
		act(() => {
			rec.onresult?.({ results: [[{ transcript: "头晕" }]] });
		});
		act(() => vi.advanceTimersByTime(850));
		expect(onSend).toHaveBeenCalledWith("头晕");
		expect(result.current.phase).toBe("sending");
	});
});

/** 可注入的假供应商：记录每次会话的选项，并暴露驱动事件（不依赖麦克风与浏览器）。 */
function makeProvider() {
	const sessions: Array<{
		options: { lang?: string; interimResults?: boolean; continuous?: boolean };
		start: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
		result: (r: { transcript: string; final: boolean }) => void;
		end: () => void;
		error: (code: string) => void;
	}> = [];
	const provider: AsrProvider = {
		id: "fake",
		supported: () => true,
		createSession: (options = {}) => {
			const entry = {
				options,
				start: vi.fn(),
				stop: vi.fn(),
				result: (_r: { transcript: string; final: boolean }) => {},
				end: () => {},
				error: (_code: string) => {},
			};
			const session: AsrSession = {
				start: entry.start,
				stop: entry.stop,
				onresult: null,
				onend: null,
				onerror: null,
			};
			entry.result = (r) => session.onresult?.(r);
			entry.end = () => session.onend?.();
			entry.error = (code) => session.onerror?.(code);
			sessions.push(entry);
			return session;
		},
	};
	return { provider, sessions };
}

describe("useVoiceDialogue（持续对谈 / 打断）", () => {
	it("持续模式：continuous + interimResults 常开；静音窗口判句尾自动提交并继续听下一句", () => {
		const { provider, sessions } = makeProvider();
		const onSend = vi.fn();
		vi.useFakeTimers();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false, continuous: true, silenceMs: 800, asrProvider: provider }),
		);

		act(() => result.current.start());
		expect(result.current.continuousArmed).toBe(true);
		expect(sessions[0].options.continuous).toBe(true);
		expect(sessions[0].options.interimResults).toBe(true);

		act(() => sessions[0].result({ transcript: "我这两天喘不上气", final: false }));
		expect(result.current.transcript).toBe("我这两天喘不上气");
		act(() => vi.advanceTimersByTime(850));
		expect(onSend).toHaveBeenCalledWith("我这两天喘不上气");
		// 提交后继续听：不是"说完就关麦"
		expect(result.current.phase).toBe("listening");
		expect(result.current.transcript).toBe("");
		expect(result.current.continuousArmed).toBe(true);

		// 第二句：供应商累计转写，本句按位移切出来
		act(() => sessions[0].result({ transcript: "我这两天喘不上气晚上更厉害", final: false }));
		expect(result.current.transcript).toBe("晚上更厉害");
		act(() => vi.advanceTimersByTime(850));
		expect(onSend).toHaveBeenLastCalledWith("晚上更厉害");
	});

	it("持续模式：患者在回复中也能开口；学生开口触发一次 onBargeIn，句尾仍把文本送入发送链", () => {
		const { provider, sessions } = makeProvider();
		const onSend = vi.fn();
		const onBargeIn = vi.fn();
		vi.useFakeTimers();
		const { result } = renderHook(() =>
			useVoiceDialogue({
				onSend,
				patientReplying: true,
				continuous: true,
				silenceMs: 800,
				asrProvider: provider,
				onBargeIn,
			}),
		);

		act(() => result.current.start());
		// 患者回复中开启持续聆听：半双工的门（patientReplying）不能挡住常开麦克风，
		// 否则学生在患者说话时开口永远打断不了
		expect(result.current.continuousArmed).toBe(true);

		act(() => sessions[0].result({ transcript: "等一下", final: false }));
		expect(onBargeIn).toHaveBeenCalledTimes(1);
		expect(result.current.interrupted).toBe(true);

		// 同一句继续说 → 不重复打断
		act(() => sessions[0].result({ transcript: "等一下医生", final: false }));
		expect(onBargeIn).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(850));
		expect(onSend).toHaveBeenCalledWith("等一下医生");
		expect(result.current.interrupted).toBe(false);
	});

	it("持续模式：回复已结束但 TTS 还在播尾音（patientSpeaking）时开口同样是打断", () => {
		const { provider, sessions } = makeProvider();
		const onSend = vi.fn();
		const onBargeIn = vi.fn();
		vi.useFakeTimers();
		const { result } = renderHook(() =>
			useVoiceDialogue({
				onSend,
				patientReplying: false,
				patientSpeaking: true,
				continuous: true,
				silenceMs: 800,
				asrProvider: provider,
				onBargeIn,
			}),
		);
		act(() => result.current.start());

		act(() => sessions[0].result({ transcript: "等一下", final: false }));
		expect(onBargeIn).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(850));
		expect(onSend).toHaveBeenCalledWith("等一下");
	});

	it("持续模式：浏览器收起会话 → 提交已说出的部分并自动重开（不静默失效）", () => {
		const { provider, sessions } = makeProvider();
		const onSend = vi.fn();
		vi.useFakeTimers();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false, continuous: true, silenceMs: 800, asrProvider: provider }),
		);
		act(() => result.current.start());

		act(() => sessions[0].result({ transcript: "头疼", final: false }));
		act(() => sessions[0].end());
		expect(onSend).toHaveBeenCalledWith("头疼");

		act(() => vi.advanceTimersByTime(300));
		expect(sessions).toHaveLength(2);
		expect(result.current.continuousArmed).toBe(true);
		expect(result.current.phase).toBe("listening");
	});

	it("持续模式：麦克风权限被拒（not-allowed）→ 明确提示并降级按住说话", () => {
		const { provider, sessions } = makeProvider();
		const onSend = vi.fn();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend, patientReplying: false, continuous: true, silenceMs: 800, asrProvider: provider }),
		);
		act(() => result.current.start());
		act(() => sessions[0].error("not-allowed"));

		expect(result.current.continuousFailed).toBe(true);
		expect(result.current.continuousArmed).toBe(false);
		expect(result.current.notice).toContain("按住说话");

		// 降级后 start() 走半双工路径（continuous=false），按住说话仍可用
		act(() => result.current.start());
		expect(sessions[1].options.continuous).toBe(false);
	});

	it("持续模式：no-speech / aborted 是连续聆听的常态噪声，不报故障也不关麦", () => {
		const { provider, sessions } = makeProvider();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend: vi.fn(), patientReplying: false, continuous: true, silenceMs: 800, asrProvider: provider }),
		);
		act(() => result.current.start());
		act(() => sessions[0].error("no-speech"));
		expect(result.current.continuousArmed).toBe(true);
		expect(result.current.notice).toBeNull();
		expect(result.current.continuousFailed).toBe(false);
	});

	it("持续模式：反复被浏览器中断 → 判定不可用并降级（不无限重开）", () => {
		const { provider, sessions } = makeProvider();
		vi.useFakeTimers();
		const { result } = renderHook(() =>
			useVoiceDialogue({ onSend: vi.fn(), patientReplying: false, continuous: true, silenceMs: 800, asrProvider: provider }),
		);
		act(() => result.current.start());
		// 每次都立刻收起（<500ms）：连续 3 次即认定持续对谈不可用，不再无限重开
		for (let i = 0; i < 3; i += 1) {
			act(() => sessions[i].end());
			act(() => vi.advanceTimersByTime(300));
		}
		expect(result.current.continuousFailed).toBe(true);
		expect(result.current.notice).toContain("按住说话");
	});
});
