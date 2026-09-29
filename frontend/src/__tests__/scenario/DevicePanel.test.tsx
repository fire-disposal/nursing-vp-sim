import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@/__tests__/render";
import { setViewport } from "@/__tests__/setup";
import type { ScenarioDevice, ScenarioDeviceChannel } from "@/api/scenario";
import BoardPanel from "@/scenario/BoardPanel";
import DevicePanel from "@/scenario/DevicePanel";
import ScenarioStage from "@/scenario/ScenarioStage";
import {
	beepPaceMs,
	readSoundEnabled,
	SOUND_PREF_KEY,
	worstStatus,
} from "@/scenario/sound";
import { makeView } from "./fixtures";

/**
 * 设备面（`docs/23` §7.5）：读数的**真实值**。
 *
 * 契约钉在这里：数值取后端的 `display`（单位单列）、`measured === false` 就是「未测量」
 * （**绝不用 0 顶替**，也不配量纲）、未知给「—」、最近更新回合可点回看、
 * 没有通道的设备不成卡片。设备是**处境的一部分**，挂在场景区里，不在动作列。
 */

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

/** 一条通道：默认是**已测量**的血氧 88%（缺失与否是显式字段，不靠省略去猜）。 */
function channel(over: Partial<ScenarioDeviceChannel> = {}): ScenarioDeviceChannel {
	return {
		ref: "scene.bed_b_sat",
		label: "血氧",
		unit: "%",
		display: "88",
		value: 88,
		status: "critical",
		delta: null,
		history: [],
		normal: null,
		critical: null,
		measured: true,
		updated_turn: null,
		...over,
	};
}

function device(over: Partial<ScenarioDevice> = {}): ScenarioDevice {
	return {
		id: "monitor_b",
		kind: "monitor",
		title: "B 床监护仪",
		sound: "off",
		channels: [channel()],
		...over,
	};
}

const MONITOR = device({
	sound: "beep",
	channels: [
		channel({
			delta: -4,
			history: [96, 94, 92, 88],
			normal: [95, 100],
			critical: [0, 90],
		}),
	],
});

const PHONE = device({
	id: "duty_phone",
	kind: "phone",
	title: "值班手机",
	channels: [
		channel({
			ref: "scene.lactate",
			label: "乳酸",
			unit: "mmol/L",
			display: "3.4",
			value: 3.4,
			status: "high",
		}),
	],
});

const deviceCard = (id: string) => document.querySelector(`[data-device="${id}"]`) as HTMLElement;
const channelCard = (ref: string) =>
	document.querySelector(`[data-channel="${ref}"]`) as HTMLElement;

describe("设备面：读数", () => {
	it("标题是设备抬头；读数用后端的 display/unit，状态与趋势各归各的钩子", () => {
		render(<DevicePanel devices={[MONITOR]} />);

		const card = deviceCard("monitor_b");
		expect(card.querySelector(".sc-device-title")?.textContent).toContain("B 床监护仪");
		expect(card.dataset.deviceKind).toBe("monitor");

		const sat = channelCard("scene.bed_b_sat");
		expect(sat.dataset.status).toBe("critical");
		expect(sat.querySelector(".sc-device-value")?.textContent).toBe("88");
		expect(sat.querySelector(".sc-device-unit")?.textContent).toBe("%");
		expect(sat.querySelector(".sc-device-status")?.textContent).toBe("危急");
		expect(within(sat).getByText("↓4")).toBeInTheDocument();
		expect(sat.querySelector(".sc-device-spark")?.getAttribute("aria-label")).toContain(
			"96 → 94 → 92 → 88",
		);
	});

	it("从未测量就说「未测量」：绝不用 0 顶替，也不配量纲", () => {
		render(
			<DevicePanel
				devices={[
					device({
						channels: [
							channel({
								// 后端可能把 display 写成 0/占位值，但 measured=false 说了"没测过"
								display: "0",
								value: 0,
								status: "unknown",
								measured: false,
								updated_turn: null,
							}),
						],
					}),
				]}
			/>,
		);

		const sat = channelCard("scene.bed_b_sat");
		expect(sat.dataset.measured).toBe("false");
		expect(sat.querySelector(".sc-device-value")?.textContent).toBe("未测量");
		expect(sat.querySelector(".sc-device-unit")).toBeNull();
		expect(within(sat).queryByText("0")).toBeNull();
		expect(sat.textContent).not.toContain("%");
	});

	it("未知或没数值给「—」，不假装有个读数、也不给量纲", () => {
		render(
			<DevicePanel
				devices={[
					device({
						id: "pump",
						kind: "pump",
						title: "输液泵",
						channels: [
							channel({
								ref: "scene.drip",
								label: "滴速",
								unit: "gtt/min",
								display: "None",
								value: null,
								status: "unknown",
							}),
						],
					}),
				]}
			/>,
		);

		const drip = channelCard("scene.drip");
		expect(drip.querySelector(".sc-device-value")?.textContent).toBe("—");
		expect(drip.querySelector(".sc-device-unit")).toBeNull();
		expect(drip.querySelector(".sc-device-spark")).toBeNull();
	});

	it("最近更新回合可点回看；页面不接就退化成纯文字", async () => {
		const user = userEvent.setup();
		const onLocateTurn = vi.fn();
		const props = {
			devices: [device({ channels: [channel({ updated_turn: 3 })] })],
		};

		const clickable = render(<DevicePanel {...props} onLocateTurn={onLocateTurn} />);
		await user.click(screen.getByRole("button", { name: "时间单位 3" }));
		expect(onLocateTurn).toHaveBeenCalledWith(3);
		clickable.unmount();

		render(<DevicePanel {...props} />);
		expect(screen.getByText("时间单位 3")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "时间单位 3" })).toBeNull();
	});

	it("没有通道的设备不成卡片，没有设备连壳都不留", () => {
		const empty = render(<DevicePanel devices={[]} />);
		expect(empty.container.querySelector(".sc-devices")).toBeNull();
		empty.unmount();

		const shell = render(<DevicePanel devices={[device({ channels: [] })]} />);
		expect(shell.container.querySelector(".sc-devices")).toBeNull();
		expect(shell.container.querySelector("[data-device]")).toBeNull();
	});
});

/**
 * 没有读数就没有"异常"这回事（`docs/23` §7.5）。后端可能给未测量的通道算出一个
 * `critical`（包里的初始值参与判断），但学生界面**绝不能把它渲染成告警**：配色、状态词、
 * 提示音、摘要全走 `shownStatus`。颜色由 `[data-status]` 决定，这里钉钩子与状态词：
 * `unknown` 是中性档，`data-attention` 缺席就是"不告警"。
 */
describe("设备面：没有读数就没有告警（未测量 / 无数值 / 档位未知）", () => {
	it("未测量或没有数值一律中性：未知档、不告警、不给数字", () => {
		render(
			<DevicePanel
				devices={[
					device({
						channels: [
							// 后端把 display 写成 0 并给了 critical：measured=false 说了"没测过"
							channel({
								ref: "scene.bp",
								label: "无创血压",
								unit: "mmHg",
								display: "0",
								value: 0,
								status: "critical",
								measured: false,
							}),
							// 测过但这一刻没有数值：同样没有读数可判"异常"
							channel({
								ref: "scene.temp",
								label: "体温",
								unit: "℃",
								display: "None",
								value: null,
								status: "critical",
								measured: true,
							}),
						],
					}),
				]}
			/>,
		);

		const notMeasured = channelCard("scene.bp");
		expect(notMeasured.dataset.status).toBe("unknown");
		expect(notMeasured.dataset.attention).toBeUndefined();
		expect(notMeasured.dataset.measured).toBe("false");
		expect(notMeasured.querySelector(".sc-device-value")?.textContent).toBe("未测量");
		expect(notMeasured.querySelector(".sc-device-status")?.textContent).toBe("未知");
		expect(notMeasured.getAttribute("title")).toBe("未知");
		// 没量过就不配量纲、也不假装有个 0
		expect(notMeasured.querySelector(".sc-device-unit")).toBeNull();
		expect(within(notMeasured).queryByText("0")).toBeNull();

		const noValue = channelCard("scene.temp");
		expect(noValue.dataset.status).toBe("unknown");
		expect(noValue.dataset.attention).toBeUndefined();
		expect(noValue.querySelector(".sc-device-value")?.textContent).toBe("—");
		expect(noValue.querySelector(".sc-device-status")?.textContent).toBe("未知");
		expect(noValue.getAttribute("title")).toBe("未知");
		expect(noValue.querySelector(".sc-device-unit")).toBeNull();
	});

	it("有真实读数就按后端档位：危急照旧告警；档位未知只是中性，数字照给", () => {
		render(
			<DevicePanel
				devices={[
					device({
						channels: [
							// 默认：已测量、有值、后端判危急
							channel(),
							// 包没声明正常/危急区间 → status=unknown，但读数是真的
							channel({
								ref: "scene.temp",
								label: "体温",
								unit: "℃",
								display: "37.2",
								value: 37.2,
								status: "unknown",
							}),
						],
					}),
				]}
			/>,
		);

		const critical = channelCard("scene.bed_b_sat");
		expect(critical.dataset.status).toBe("critical");
		expect(critical.dataset.attention).toBe("critical");
		expect(critical.querySelector(".sc-device-status")?.textContent).toBe("危急");
		expect(critical.querySelector(".sc-device-value")?.textContent).toBe("88");
		expect(critical.querySelector(".sc-device-unit")?.textContent).toBe("%");

		// 档位未知不等于没读数：数字与单位照给，状态词中性，不挂告警
		const unknown = channelCard("scene.temp");
		expect(unknown.dataset.status).toBe("unknown");
		expect(unknown.dataset.attention).toBeUndefined();
		expect(unknown.querySelector(".sc-device-value")?.textContent).toBe("37.2");
		expect(unknown.querySelector(".sc-device-unit")?.textContent).toBe("℃");
		expect(unknown.querySelector(".sc-device-status")?.textContent).toBe("未知");
		expect(unknown.getAttribute("title")).toBe("未知");
	});
});

describe("设备面：窄屏默认收成一行摘要（纵向空间留给对话流）", () => {
	/** 两条读数的监护仪：一条危急、一条正常——摘要要一次报完，状态色各归各的读数。 */
	const twoChannel = device({
		channels: [
			channel(),
			channel({
				ref: "scene.hr",
				label: "心率",
				unit: "次/分",
				display: "112",
				value: 112,
				status: "normal",
			}),
		],
	});

	// 视口是模块级状态：用完收回去，别漏给别的用例
	afterEach(() => setViewport(1024, 768));

	it("390 默认收起：摘要一行报完每条读数（单位跟着数字），状态色各归各的读数", () => {
		setViewport(390, 844);
		render(<DevicePanel devices={[twoChannel]} />);

		const card = deviceCard("monitor_b");
		expect(card.dataset.expanded).toBe("false");

		const summary = card.querySelector(".sc-device-summary") as HTMLElement;
		expect(summary.textContent).toBe("血氧 88%·心率 112 次/分");
		expect(summary.querySelector('[data-status="critical"]')?.textContent).toBe("血氧 88%");
		expect(summary.querySelector('[data-status="normal"]')?.textContent).toBe("心率 112 次/分");
		// 收起的是版面，不是信息：最差状态进开关的可访问名，读屏不缺这一句
		expect(
			screen.getByRole("button", { name: "B 床监护仪：血氧 88% · 心率 112 次/分（危急）" }),
		).toBeInTheDocument();
	});

	it("点一下摊开完整通道；桌面进来本来就是摊开的", async () => {
		const user = userEvent.setup();
		setViewport(390, 844);
		render(<DevicePanel devices={[twoChannel]} />);

		const toggle = screen.getByRole("button", { name: /^B 床监护仪/ });
		await user.click(toggle);
		expect(deviceCard("monitor_b").dataset.expanded).toBe("true");
		expect(toggle).toHaveAttribute("aria-expanded", "true");

		// 桌面：默认就是摊开的（收起来只是窄屏的默认值，不是设备面的常态）
		setViewport(1024, 768);
		render(<DevicePanel devices={[twoChannel]} />);
		expect(deviceCard("monitor_b").dataset.expanded).toBe("true");
	});

	it("学生自己开合过之后，改视口不改他的选择", async () => {
		const user = userEvent.setup();
		setViewport(390, 844);
		render(<DevicePanel devices={[twoChannel]} />);

		await user.click(screen.getByRole("button", { name: /^B 床监护仪/ }));
		// 旋屏 / 缩放到桌面宽度：他刚摊开的那一栏不该自己收回去
		setViewport(1024, 768);
		expect(deviceCard("monitor_b").dataset.expanded).toBe("true");
	});
});

describe("设备面：提示音", () => {
	it("默认静音：不建音频上下文、一声不出", () => {
		render(<DevicePanel devices={[MONITOR]} />);
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
		render(<DevicePanel devices={[MONITOR]} />);

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
		render(<DevicePanel devices={[MONITOR]} />);
		expect(screen.getByRole("button", { name: /提示音/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(audio.contexts).toBe(1);
	});

	it("标签页隐藏时暂停（隐藏即不再滴）", () => {
		vi.useFakeTimers();
		localStorage.setItem(SOUND_PREF_KEY, "1");
		render(<DevicePanel devices={[MONITOR]} />);
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

	it("电话这类不响的设备照常给读数，但不给声音开关", () => {
		render(<DevicePanel devices={[PHONE]} />);

		expect(deviceCard("duty_phone").dataset.deviceKind).toBe("phone");
		const lactate = channelCard("scene.lactate");
		expect(lactate.querySelector(".sc-device-value")?.textContent).toBe("3.4");
		expect(lactate.querySelector(".sc-device-unit")?.textContent).toBe("mmol/L");
		expect(lactate.dataset.status).toBe("high");
		// 没有 history 就不画折线，也没有 delta 可报
		expect(lactate.querySelector(".sc-device-spark")).toBeNull();
		expect(lactate.querySelector(".sc-device-delta")).toBeNull();
		expect(screen.queryByRole("button", { name: /提示音/ })).toBeNull();
	});
});

describe("设备在场景区（处境的一部分，不属于动作列）", () => {
	it("设备面板挂在场景区里，与画面并列", () => {
		render(<ScenarioStage view={makeView({ devices: [MONITOR] })} />);

		const scene = document.querySelector(".sc-scene") as HTMLElement;
		expect(scene).not.toBeNull();
		expect(scene.dataset.devices).toBe("true");
		const instrument = scene.querySelector(".sc-devices") as HTMLElement;
		expect(instrument).not.toBeNull();
		expect(instrument.parentElement).toBe(scene);
		expect(instrument.querySelector('[data-device="monitor_b"]')).not.toBeNull();
	});

	it("没有设备时场景区只剩画面，不留空位（设备节点根本不存在）", () => {
		render(<ScenarioStage view={makeView()} />);

		const scene = document.querySelector(".sc-scene") as HTMLElement;
		expect(scene.dataset.devices).toBe("false");
		expect(scene.querySelector(".sc-devices")).toBeNull();
	});
});

describe("设备与白板互补：同一读数不出现两次", () => {
	it("血氧只在设备面上（白板不重复列被设备覆盖的读数）", () => {
		const view = makeView({
			devices: [MONITOR],
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
							{
								id: "cue:bed_b_light",
								kind: "cue",
								text: "B 床那侧只亮着冷光",
								source: "pack",
							},
						],
					},
				],
			},
		});

		render(
			<>
				<DevicePanel devices={view.devices ?? []} />
				<aside className="sc-side">
					<BoardPanel board={view.board ?? { editable: false, entry_count: 0, sections: [] }} />
				</aside>
			</>,
		);

		expect(
			deviceCard("monitor_b").querySelector('[data-channel="scene.bed_b_sat"]'),
		).not.toBeNull();
		const board = document.querySelector(".sc-board") as HTMLElement;
		expect(board.textContent).toContain("B 床那侧只亮着冷光");
		expect(board.textContent).not.toContain("血氧");
	});
});
