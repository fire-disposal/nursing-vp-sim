import { afterEach, describe, expect, it, vi } from "vitest";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";

/**
 * 播放时间线只接受当前回复的块。打断后网络层即使把已到达的块送回来，
 * 也不能再排进 AudioContext，否则“停播”之后会冒出半句话。
 */

class FakeSource {
	buffer: AudioBuffer | null = null;
	onended: (() => void) | null = null;
	connect = vi.fn();
	start = vi.fn();
	stop = vi.fn();
}

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	currentTime = 0;
	state = "running";
	destination = {} as AudioDestinationNode;
	sources: FakeSource[] = [];

	constructor() {
		FakeAudioContext.instances.push(this);
	}

	createGain() {
		return { connect: vi.fn(), disconnect: vi.fn() } as unknown as GainNode;
	}

	createAnalyser() {
		return {
			fftSize: 0,
			smoothingTimeConstant: 0,
			connect: vi.fn(),
			getFloatTimeDomainData: vi.fn(),
		} as unknown as AnalyserNode;
	}

	createBuffer(_channels: number, length: number, sampleRate: number) {
		return {
			length,
			sampleRate,
			duration: length / sampleRate,
			copyToChannel: vi.fn(),
		} as unknown as AudioBuffer;
	}

	createBufferSource() {
		const source = new FakeSource();
		this.sources.push(source);
		return source as unknown as AudioBufferSourceNode;
	}

	resume = vi.fn(async () => undefined);
	close = vi.fn(async () => undefined);
}

function installAudioContext(): void {
	vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
}

afterEach(() => {
	vi.unstubAllGlobals();
	FakeAudioContext.instances = [];
});

describe("PcmStreamPlayer.playStream", () => {
	it("abort 后不再把已到达的块排进时间线", async () => {
		installAudioContext();
		let controller: ReadableStreamDefaultController<Uint8Array> = null as never;
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c;
			},
		});
		const abort = new AbortController();
		const player = new PcmStreamPlayer();
		const done = player.playStream(stream, undefined, abort.signal);
		controller.enqueue(new Uint8Array([0, 0, 1, 0]));
		await vi.waitFor(() => expect(FakeAudioContext.instances[0].sources).toHaveLength(1));

		controller.enqueue(new Uint8Array([0, 0, 2, 0]));
		abort.abort();
		await done;

		expect(FakeAudioContext.instances[0].sources).toHaveLength(1);
	});

	it("signal 已 abort 时不创建音频时间线", async () => {
		installAudioContext();
		const abort = new AbortController();
		abort.abort();
		const player = new PcmStreamPlayer();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([0, 0]));
				controller.close();
			},
		});

		await expect(player.playStream(stream, undefined, abort.signal)).resolves.toBe(0);
		expect(FakeAudioContext.instances).toHaveLength(0);
	});
});
