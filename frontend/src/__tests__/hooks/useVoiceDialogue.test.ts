import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
