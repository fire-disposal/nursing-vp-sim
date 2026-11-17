import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceTurnController } from "@/engine/asr/turnController";

/**
 * 持续对谈的真实轮次逻辑（纯状态机，无浏览器 API）。
 * 覆盖：250ms 才打断、backchannel/misfire 不打断、definite 才发送、重复/迟到不发送、空输入不发送。
 */

interface Harness {
	controller: VoiceTurnController;
	sent: string[];
	barges: number;
	transcripts: string[];
	audible: { value: boolean };
}

function makeHarness(options: { audible?: boolean; finalTimeoutMs?: number; endpointMs?: number } = {}): Harness {
	const sent: string[] = [];
	const transcripts: string[] = [];
	const audible = { value: options.audible ?? false };
	let barges = 0;
	const controller = new VoiceTurnController(
		{
			onSend: (text) => sent.push(text),
			onBargeIn: () => {
				barges += 1;
			},
			onTranscript: (text) => {
				if (text) transcripts.push(text);
			},
		},
		{
			patientAudible: () => audible.value,
			finalTimeoutMs: options.finalTimeoutMs ?? 2500,
			endpointMs: options.endpointMs ?? 1200,
		},
	);
	return {
		controller,
		sent,
		transcripts,
		audible,
		get barges() {
			return barges;
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("轮次：打断需要 speechRealStart", () => {
	it("does not barge in on speechStart alone (short noise while patient speaks)", () => {
		const h = makeHarness({ audible: true });
		h.controller.start();
		h.controller.speechStart();
		expect(h.barges).toBe(0);
	});

	it("barges in once the VAD confirms >=250ms of real speech", () => {
		const h = makeHarness({ audible: true });
		h.controller.start();
		h.controller.speechStart();
		h.controller.speechRealStart();
		expect(h.barges).toBe(1);
	});

	it("never barges in when the patient is silent", () => {
		const h = makeHarness({ audible: false });
		h.controller.start();
		h.controller.speechStart();
		h.controller.speechRealStart();
		expect(h.barges).toBe(0);
	});

	it("a misfire after a backchannel keeps playback and sends nothing", () => {
		const h = makeHarness({ audible: true });
		h.controller.start();
		h.controller.speechStart();
		h.controller.misfire();
		vi.advanceTimersByTime(5000);
		expect(h.barges).toBe(0);
		expect(h.sent).toEqual([]);
	});

	it("misfire after a confirmed barge-in does not stop the student's turn", () => {
		const h = makeHarness({ audible: true });
		h.controller.start();
		h.controller.speechStart();
		h.controller.speechRealStart();
		h.controller.misfire();
		h.controller.partial("你好");
		h.controller.definite("你好");
		expect(h.sent).toEqual(["你好"]);
	});

	it("only barges in once per turn", () => {
		const h = makeHarness({ audible: true });
		h.controller.start();
		h.controller.speechStart();
		h.controller.speechRealStart();
		h.controller.speechRealStart();
		expect(h.barges).toBe(1);
	});
});

describe("轮次：只有 definite 才提交", () => {
	it("partials never send", () => {
		const h = makeHarness();
		h.controller.start();
		h.controller.speechStart();
		h.controller.speechRealStart();
		h.controller.partial("你哪里");
		h.controller.partial("你哪里不舒服");
		vi.advanceTimersByTime(5000);
		expect(h.sent).toEqual([]);
		expect(h.transcripts).toContain("你哪里不舒服");
	});

	it("sends exactly once when the definite lands", () => {
		const h = makeHarness();
		h.controller.start();
		h.controller.speechStart();
		h.controller.partial("哪里不舒服");
		h.controller.speechEnd();
		h.controller.definite("哪里不舒服？");
		expect(h.sent).toEqual(["哪里不舒服？"]);
	});

	it("ignores a duplicated definite for the same turn", () => {
		const h = makeHarness();
		h.controller.start();
		h.controller.speechStart();
		h.controller.definite("你好");
		h.controller.definite("你好");
		expect(h.sent).toEqual(["你好"]);
	});

	it("does not send an empty definite", () => {
		const h = makeHarness();
		h.controller.start();
		h.controller.speechStart();
		h.controller.speechRealStart();
		h.controller.speechEnd();
		h.controller.definite("");
		vi.advanceTimersByTime(5000);
		expect(h.sent).toEqual([]);
	});

	it("drops the turn when speechEnd never gets a definite (no dead spin)", () => {
		const h = makeHarness({ finalTimeoutMs: 1000 });
		h.controller.start();
		h.controller.speechStart();
		h.controller.partial("你好");
		h.controller.speechEnd();
		vi.advanceTimersByTime(1000);
		// 超时后本轮作废：迟到的 definite 不得提交
		h.controller.definite("你好");
		expect(h.sent).toEqual([]);
		// 下一轮开口才重新开始
		h.controller.speechStart();
		h.controller.definite("下一句");
		expect(h.sent).toEqual(["下一句"]);
	});

	it("a new speech start cancels the pending endpoint wait", () => {
		const h = makeHarness({ finalTimeoutMs: 1000 });
		h.controller.start();
		h.controller.speechStart();
		h.controller.speechEnd();
		vi.advanceTimersByTime(500);
		// 重新开口：换一轮，旧的 final 计时不得把新的一轮清空
		h.controller.speechStart();
		vi.advanceTimersByTime(1000);
		h.controller.partial("我又说了");
		h.controller.definite("我又说了");
		expect(h.sent).toEqual(["我又说了"]);
	});
});

describe("轮次：epoch 隔离", () => {
	it("a definite from an old session after stop is dropped", () => {
		const h = makeHarness();
		const epoch = h.controller.start();
		h.controller.speechStart(epoch);
		h.controller.stop();
		h.controller.definite("迟到的一句话", epoch);
		expect(h.sent).toEqual([]);
	});

	it("an old interim timer does not fire after stop", () => {
		const h = makeHarness({ endpointMs: 500 });
		h.controller.start();
		h.controller.interim("你好");
		h.controller.stop();
		vi.advanceTimersByTime(2000);
		expect(h.sent).toEqual([]);
	});

	it("a stale epoch cannot open a turn", () => {
		const h = makeHarness({ audible: true });
		const epoch = h.controller.start();
		const nextEpoch = h.controller.start();
		h.controller.speechRealStart(epoch);
		expect(nextEpoch).not.toBe(epoch);
		expect(h.barges).toBe(0);
	});
});

describe("轮次：无 VAD 的降级路径", () => {
	it("interim text starts the endpoint window and commits at its end", () => {
		const h = makeHarness({ endpointMs: 800 });
		h.controller.start();
		h.controller.interim("你叫什么名字");
		vi.advanceTimersByTime(800);
		expect(h.sent).toEqual(["你叫什么名字"]);
	});

	it("keeps extending the window while text keeps arriving", () => {
		const h = makeHarness({ endpointMs: 800 });
		h.controller.start();
		h.controller.interim("你叫");
		vi.advanceTimersByTime(700);
		h.controller.interim("你叫什么");
		vi.advanceTimersByTime(700);
		expect(h.sent).toEqual([]);
		vi.advanceTimersByTime(200);
		expect(h.sent).toEqual(["你叫什么"]);
	});

	it("barges in on interim text while the patient is audible", () => {
		const h = makeHarness({ audible: true, endpointMs: 800 });
		h.controller.start();
		h.controller.interim("等一下");
		expect(h.barges).toBe(1);
	});
});
