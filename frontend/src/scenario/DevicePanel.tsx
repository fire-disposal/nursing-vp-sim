import { useState } from "react";
import type { ScenarioDevice, ScenarioDeviceChannel } from "@/api/scenario";
import { readSoundEnabled, useDeviceSound, writeSoundEnabled } from "./sound";

/**
 * 设备面——场景里设备的**实时读数**（与白板互补：白板放"已确立的事"）。
 *
 * - 数值用后端给的 `display`（小数位由 pack 声明），前端不重新格式化；
 * - `status` 只改**配色**（正常中性 / 偏低偏高琥珀 / 危急红），**不闪烁、不动画**：
 *   危急是"请注意"，不是警报；
 * - 设备与通道都由后端按需求过滤：这里是这一回合**真实的**设备清单，
 *   前端不缓存旧视图、不补位（所以"还没看那床"时它就该不在）。
 */

const CHANNEL_STATUS_LABEL: Record<string, string> = {
	normal: "正常",
	low: "偏低",
	high: "偏高",
	critical: "危急",
	unknown: "未知",
};

const SOUND_LABEL = "提示音";

/** 趋势：一条无坐标轴无网格的小折线；点少于 2 个就不画（没有趋势就不假装有）。 */
function Sparkline({ points, status }: { points: number[]; status: string }) {
	if (points.length < 2) return null;
	const width = 64;
	const height = 20;
	const min = Math.min(...points);
	const max = Math.max(...points);
	const span = max - min || 1;
	const step = width / (points.length - 1);
	const path = points
		.map((value, index) => {
			const x = index * step;
			const y = height - ((value - min) / span) * height;
			return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
	return (
		<svg
			className="sc-device-spark"
			data-status={status}
			viewBox={`0 0 ${width} ${height}`}
			width={width}
			height={height}
			role="img"
			aria-label={`趋势：${points.map((p) => String(p)).join(" → ")}`}
			preserveAspectRatio="none"
		>
			<path d={path} fill="none" vectorEffect="non-scaling-stroke" />
		</svg>
	);
}

/** 趋势箭头：只在后端给了 `delta` 时出现（它是"相比上一次"的变化，不是猜测）。 */
function Delta({ delta }: { delta: number }) {
	const up = delta > 0;
	return (
		<span className="sc-device-delta" data-dir={up ? "up" : "down"}>
			{up ? "↑" : "↓"}
			{Math.abs(delta)}
		</span>
	);
}

/**
 * 通道读数：`status === "unknown"` 或根本没有数值时显示 `—`，**不显示 0**
 * （0 是一个真实的读数，缺失不是 0；后端把非数值读成 unknown，这里如实留白）。
 */
function channelDisplay(channel: ScenarioDeviceChannel): string {
	const hasValue = channel.value !== null && channel.value !== undefined;
	if (channel.status === "unknown" || !hasValue) return "—";
	return channel.display;
}

function Channel({ channel }: { channel: ScenarioDeviceChannel }) {
	return (
		<div
			className="sc-device-channel"
			data-channel={channel.ref}
			data-status={channel.status}
			data-attention={channel.status === "critical" ? "critical" : undefined}
			title={CHANNEL_STATUS_LABEL[channel.status] ?? channel.status}
		>
			<span className="sc-device-channel-label">{channel.label}</span>
			<span className="sc-device-value">{channelDisplay(channel)}</span>
			{channel.unit && <span className="sc-device-unit">{channel.unit}</span>}
			{channel.delta !== null && <Delta delta={channel.delta} />}
			{channel.history.length > 1 && (
				<Sparkline points={channel.history} status={channel.status} />
			)}
			<span className="sc-device-status">
				{CHANNEL_STATUS_LABEL[channel.status] ?? channel.status}
			</span>
		</div>
	);
}

export default function DevicePanel({ devices }: { devices: ScenarioDevice[] }) {
	// 默认静音；开关是学生显式动作，偏好记在本地
	const [soundOn, setSoundOn] = useState(readSoundEnabled);
	const statuses = devices.flatMap((device) =>
		device.channels.map((channel) => channel.status),
	);
	useDeviceSound(soundOn, statuses);

	if (devices.length === 0) return null;
	const anyBeep = devices.some((device) => device.sound === "beep");

	return (
		<section className="sc-devices" aria-label="设备读数">
			<div className="sc-devices-head">
				<span className="sc-devices-title">设备读数</span>
				{anyBeep && (
					<button
						type="button"
						className="sc-sound-toggle"
						aria-pressed={soundOn}
						data-on={soundOn}
						onClick={() => {
							const next = !soundOn;
							setSoundOn(next);
							writeSoundEnabled(next);
						}}
					>
						{SOUND_LABEL}
						<span className="sc-sound-state">{soundOn ? "开" : "静音"}</span>
					</button>
				)}
			</div>

			{devices.map((device) => (
				<div
					className="sc-device"
					key={device.id}
					data-device={device.id}
					data-device-kind={device.kind}
				>
					<div className="sc-device-title">
						<span>{device.title}</span>
						{/* 电话是"回报"，不是实时波形：不给折线，只列条目 */}
						<span className="sc-device-kind">
							{device.kind === "monitor"
								? "实时"
								: device.kind === "phone"
									? "通话 / 回报"
									: "设备"}
						</span>
					</div>
					<div className="sc-device-channels">
						{device.channels.map((channel) => (
							<Channel key={channel.ref} channel={channel} />
						))}
					</div>
				</div>
			))}
		</section>
	);
}
