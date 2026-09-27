import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@/__tests__/render";
import type { ScenarioDevice, ScenarioView } from "@/api/scenario";
import BoardPanel from "@/scenario/BoardPanel";
import DevicePanel from "@/scenario/DevicePanel";
import ScenarioStage from "@/scenario/ScenarioStage";
import {
	beepPaceMs,
	readSoundEnabled,
	SOUND_PREF_KEY,
	worstStatus,
} from "@/scenario/sound";

// ── 音频替身：只数"什么时候滴了几次"，不真的出声 ───────────────────────────
const audio = vi.hoisted(() => ({ contexts: 0, beeps: 0, closed: 0, resumed: 0 }));

class FakeAudioContext {
	state = "running";
	currentTime = 0;
	destination = {};
	constructor() {
		audio.contexts += 1;
	}
	createOscillator() {
		return {
			type: "sine",
			frequency: { value: 0 },
			connect() {},
			start() {
				audio.beeps += 1;
			},
			stop() {},
		};
	}
	createGain() {
		return { gain: { value: 0 }, connect() {} };
	}
	resume() {
		audio.resumed += 1;
		return Promise.resolve();
	}
	close() {
		audio.closed += 1;
		return Promise.resolve();
	}
}

beforeEach(() => {
	vi.stubGlobal("AudioContext", FakeAudioContext);
	vi.stubGlobal("webkitAudioContext", FakeAudioContext);
	localStorage.clear();
	audio.contexts = 0;
	audio.beeps = 0;
	audio.closed = 0;
	audio.resumed = 0;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const monitor: ScenarioDevice = {
	id: "monitor_b",
	kind: "monitor",
	title: "B 床监护仪",
	sound: "beep",
	channels: [
		{
			ref: "scene.bed_b_sat",
			label: "血氧",
			unit: "%",
			display: "88",
			value: 88,
			status: "critical",
			delta: -4,
			history: [96, 94, 92, 88],
			normal: [95, 100],
			critical: [0, 90],
		},
	],
};

const phone: ScenarioDevice = {
	id: "duty_phone",
	kind: "phone",
	title: "值班手机",
	sound: "off",
	channels: [
		{
			ref: "scene.lactate",
			label: "乳酸",
			unit: "mmol/L",
			display: "3.4",
			value: 3.4,
			status: "high",
			delta: null,
			history: [],
			normal: [0.5, 2],
			critical: null,
		},
	],
};

/** 只带设备的视图：够 ScenarioStage 渲染即可（画面/线索这些都无关紧要）。 */
function sceneView(devices: ScenarioDevice[]): ScenarioView {
	return {
		session: { id: 1, status: "active", turn: 1, lost: false },
		pack: { key: "two-beds-priority", title: "两床同铃", player_role: "夜班护士" },
		situation: {
			place: "呼吸内科病房",
			time_hint: "凌晨 03:40",
			resources: [],
			visible_cues: [],
			noticed: [],
		},
		actors: [],
		hud: [],
		messages: [{ role: "scene", text: "走廊里只有监护仪在叫。", turn: 1 }],
		options: [],
		affordances: [],
		free_input: true,
		timeline: [],
		dims: [],
		nudges: [],
		problems: [],
		devices,
	};
}

describe("设备面：读数", () => {
	it("监护仪用后端的 display/unit 呈现，status 走 data 钩子，趋势有箭头与小折线", () => {
		render(<DevicePanel devices={[monitor]} />);

		const device = document.querySelector('[data-device="monitor_b"]') as HTMLElement;
		expect(device).not.toBeNull();
		expect(device.dataset.deviceKind).toBe("monitor");
		expect(within(device).getByText("B 床监护仪")).toBeInTheDocument();

		const channel = document.querySelector(
			'[data-channel="scene.bed_b_sat"]',
		) as HTMLElement;
		expect(channel.dataset.status).toBe("critical");
		// 大号数值用 display（不重新格式化），单位单独呈现
		expect(within(channel).getByText("88")).toBeInTheDocument();
		expect(within(channel).getByText("%")).toBeInTheDocument();
		expect(within(channel).getByText("危急")).toBeInTheDocument();
		// 趋势：↓4 + 一条无坐标轴的折线
		expect(within(channel).getByText("↓4")).toBeInTheDocument();
		expect(channel.querySelector(".sc-device-spark")).not.toBeNull();
		expect(
			channel.querySelector(".sc-device-spark")?.getAttribute("aria-label"),
		).toContain("96 → 94 → 92 → 88");
	});

	it("电话不做折线：通道按回报条目列", () => {
		render(<DevicePanel devices={[phone]} />);
		const device = document.querySelector('[data-device="duty_phone"]') as HTMLElement;
		expect(device.dataset.deviceKind).toBe("phone");
		expect(within(device).getByText("3.4")).toBeInTheDocument();
		expect(within(device).getByText("偏高")).toBeInTheDocument();
		expect(device.querySelector(".sc-device-spark")).toBeNull();
		expect(device.querySelector(".sc-device-delta")).toBeNull();
		// 电话没有 sound=beep → 连声音开关都不出现
		expect(screen.queryByRole("button", { name: /提示音/ })).toBeNull();
	});

	it("门控设备没出现就不渲染（不补位、不残留旧视图）", () => {
		const { container } = render(<DevicePanel devices={[]} />);
		expect(container.querySelector(".sc-devices")).toBeNull();
		expect(container.querySelector("[data-device]")).toBeNull();
	});
});

describe("设备面：提示音", () => {
	it("默认静音：不建音频上下文、一声不出", () => {
		render(<DevicePanel devices={[monitor]} />);
		expect(screen.getByRole("button", { name: /提示音/ })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(audio.contexts).toBe(0);
		expect(audio.beeps).toBe(0);
		expect(readSoundEnabled()).toBe(false);
	});

	it("打开开关后按节奏滴滴：危急 1.2s 一次，关掉即停", () => {
		vi.useFakeTimers();
		render(<DevicePanel devices={[monitor]} />);

		// 假定时器下用同步 click：状态更新与 effect 在同一个 tick 里完成
		fireEvent.click(screen.getByRole("button", { name: /提示音/ }));
		expect(readSoundEnabled()).toBe(true);
		expect(localStorage.getItem(SOUND_PREF_KEY)).toBe("1");
		// 打开即先滴一声（学生按下去的这一刻要给到反馈）
		expect(audio.beeps).toBe(1);

		vi.advanceTimersByTime(3600);
		// 1.2s 一次 → 3.6s 里再来 3 声，绝不高频
		expect(audio.beeps).toBe(4);

		// 关掉后不再滴（偏好也记下来）
		fireEvent.click(screen.getByRole("button", { name: /提示音/ }));
		expect(readSoundEnabled()).toBe(false);
		vi.advanceTimersByTime(5000);
		expect(audio.beeps).toBe(4);
	});

	it("偏好持久化：上次开着，这次进来就是开着的", () => {
		localStorage.setItem(SOUND_PREF_KEY, "1");
		render(<DevicePanel devices={[monitor]} />);
		expect(screen.getByRole("button", { name: /提示音/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(audio.contexts).toBe(1);
	});

	it("标签页隐藏时暂停（隐藏即不再滴）", () => {
		vi.useFakeTimers();
		localStorage.setItem(SOUND_PREF_KEY, "1");
		render(<DevicePanel devices={[monitor]} />);
		expect(audio.beeps).toBe(1);

		const setHidden = (hidden: boolean) =>
			act(() => {
				Object.defineProperty(document, "hidden", {
					value: hidden,
					configurable: true,
				});
				document.dispatchEvent(new Event("visibilitychange"));
			});

		setHidden(true);
		const before = audio.beeps;
		vi.advanceTimersByTime(6000);
		expect(audio.beeps).toBe(before);

		setHidden(false);
		vi.advanceTimersByTime(2400);
		expect(audio.beeps).toBeGreaterThan(before);
	});

	it("节奏与音调只由最差状态决定", () => {
		expect(worstStatus(["normal", "critical"])).toBe("critical");
		expect(worstStatus(["normal", "low"])).toBe("low");
		expect(worstStatus([])).toBeNull();
		expect(beepPaceMs("normal")).toBe(3000);
		expect(beepPaceMs("high")).toBe(2000);
		expect(beepPaceMs("critical")).toBe(1200);
		expect(beepPaceMs(null)).toBeNull();
	});
});

describe("设备在场景区（处境的一部分，不属于动作列）", () => {
	it("设备面板挂在场景区内，动作区里没有设备", () => {
		render(
			<>
				<ScenarioStage view={sceneView([monitor])} />
				<section className="sc-actions" />
			</>,
		);

		const scene = document.querySelector(".sc-scene") as HTMLElement;
		expect(scene).not.toBeNull();
		expect(scene.querySelector(".sc-stage")).not.toBeNull();
		// 仪器是场景区的直接子元素（与画面并列的一栏），不是塞在"画面之下"那一栏里
		expect(scene.dataset.devices).toBe("true");
		const instrument = scene.querySelector(".sc-devices") as HTMLElement;
		expect(instrument).not.toBeNull();
		expect(instrument.parentElement).toBe(scene);
		expect(instrument.querySelector('[data-device="monitor_b"]')).not.toBeNull();
		expect(
			(document.querySelector(".sc-actions") as HTMLElement).querySelector(
				"[data-device]",
			),
		).toBeNull();
	});

	it("没有设备时场景区只有画面，不留空位（设备节点根本不存在）", () => {
		render(<ScenarioStage view={sceneView([])} />);
		const scene = document.querySelector(".sc-scene") as HTMLElement;
		expect(scene.querySelector(".sc-stage")).not.toBeNull();
		expect(scene.querySelector(".sc-devices")).toBeNull();
		// 没有设备时不留空位：双栏布局整个不生效，场景区里也没有设备壳
		expect(scene.dataset.devices).toBe("false");
		// 场景区只有画面本身（缩略图/HUD 已收进画面层内，不再是并列的第二块）
		expect(scene.children).toHaveLength(1);
	});

	it("unknown / 无数值显示「—」而不是 0；危急只给静态注意钩子", () => {
		render(
			<DevicePanel
				devices={[
					{
						id: "pump",
						kind: "pump",
						title: "输液泵",
						sound: "off",
						channels: [
							{
								ref: "scene.drip",
								label: "滴速",
								unit: "gtt/min",
								display: "None",
								value: null,
								status: "unknown",
								delta: null,
								history: [],
								normal: null,
								critical: null,
							},
						],
					},
				]}
			/>,
		);
		const channel = document.querySelector('[data-channel="scene.drip"]') as HTMLElement;
		expect(channel.querySelector(".sc-device-value")?.textContent).toBe("—");
		expect(channel.dataset.attention).toBeUndefined();
		expect(channel.querySelector(".sc-device-spark")).toBeNull();
	});

	it("危急通道带静态注意钩子（data-attention），正常通道不带", () => {
		render(<DevicePanel devices={[monitor, phone]} />);
		expect(
			(document.querySelector('[data-channel="scene.bed_b_sat"]') as HTMLElement).dataset
				.attention,
		).toBe("critical");
		expect(
			(document.querySelector('[data-channel="scene.lactate"]') as HTMLElement).dataset
				.attention,
		).toBeUndefined();
	});
});

describe("设备与白板互补：同一读数不出现两次", () => {
	it("血氧只在设备面上（白板不再列被设备覆盖的读数）", () => {
		const view: ScenarioView = {
			session: { id: 1, status: "active", turn: 1, lost: false },
			pack: { key: "two-beds-priority", title: "两床同铃", player_role: "夜班护士" },
			situation: {
				place: "呼吸内科病房",
				time_hint: "凌晨 03:40",
				resources: [],
				visible_cues: [],
				noticed: [],
			},
			actors: [],
			hud: [],
			messages: [],
			options: [],
			affordances: [],
			free_input: true,
			timeline: [],
			dims: [],
			nudges: [],
			problems: [],
			board: {
				editable: false,
				entry_count: 1,
				sections: [
					{
						id: "board_scene",
						title: "现场看到的",
						source: "cue",
						more: 0,
						entries: [
							{ id: "cue:c1", kind: "cue", text: "B 床那侧只亮着冷光", source: "pack" },
						],
					},
				],
			},
			devices: [monitor],
		};

		const { container } = render(
			<>
				<DevicePanel devices={view.devices ?? []} />
				<aside className="sc-side">
					<BoardPanel board={view.board ?? { editable: false, entry_count: 0, sections: [] }} />
				</aside>
			</>,
		);

		// 设备面有读数
		expect(
			document.querySelector('[data-device="monitor_b"] [data-channel="scene.bed_b_sat"]'),
		).not.toBeNull();
		// 白板里没有它（前端不把读数塞进白板）
		const board = container.querySelector(".sc-board") as HTMLElement;
		expect(board.querySelector("[data-entry-id='state:scene.bed_b_sat']")).toBeNull();
		expect(board.textContent).not.toContain("88");
		expect(container.querySelectorAll("[data-channel]")).toHaveLength(1);
	});
});
