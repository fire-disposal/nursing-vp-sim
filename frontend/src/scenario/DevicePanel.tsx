import { IconChevronDown } from "@tabler/icons-react";
import { Fragment, useState } from "react";
import type { ScenarioDevice, ScenarioDeviceChannel } from "@/api/scenario";
import {
	readSoundEnabled,
	useDeviceSound,
	worstStatus,
	writeSoundEnabled,
} from "./sound";
import { useNarrowScreen } from "./viewport";

/**
 * 设备面——场景里设备的**实时读数**（与白板互补：白板放"已确立的事"）。
 *
 * - 数值用后端给的 `display`（小数位由 pack 声明），前端不重新格式化；
 * - `measured === false` 表示**从未测量**：显示「未测量」，**绝不用 0 顶替**
 *   （0 是一个真实读数，缺失不是 0）；`display === "—"` 表示未知/未测；
 * - `status` 只改**配色**（正常中性 / 偏低偏高琥珀 / 危急红），**不闪烁、不动画**：
 *   危急是"请注意"，不是警报；
 * - 每个通道标出**最近更新时间点**（`updated_turn`，时间单位），可点回看；没有就如实不给；
 * - 设备与通道都由后端按需求过滤：这里是此刻**真实的**设备清单，
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

/** 这个通道**现在是否有一个真实读数**（未测量 / 未知 / 无数值 = 否）。 */
/**
 * 呈现用的状态：**未测量或没有数值一律当未知**。
 *
 * 后端若哪天又给「未测量」的通道算出一个 `critical`（包里的初始值参与判断），学生界面
 * 也不能把它渲染成告警——没有测量结果就没有"异常"这回事。这里是唯一收口处：
 * 配色、状态词、提示音、摘要全走它，谁都别直接读 `channel.status`。
 */
function shownStatus(channel: ScenarioDeviceChannel): string {
	if (channel.measured === false) return "unknown";
	if (channel.value === null || channel.value === undefined) return "unknown";
	return channel.status;
}

/**
 * 有没有**真实读数**：只取决于"测量过没有 + 有没有值"。
 *
 * 与"档位未知"是两件事：包没声明正常/危急区间时该值照样要显示（读数是真的），
 * 只是没有可判定的档位（`status === "unknown"` → 中性呈现，不告警）。
 */
function hasReading(channel: ScenarioDeviceChannel): boolean {
	if (channel.measured === false) return false;
	return channel.value !== null && channel.value !== undefined;
}

/**
 * 通道读数：**从未测量**（`measured === false`）显示「未测量」；未知或无数值显示 `—`；
 * 绝不用 0 顶替缺失（0 是一个真实的读数）。
 */
function channelDisplay(channel: ScenarioDeviceChannel): string {
	if (channel.measured === false) return "未测量";
	if (!hasReading(channel)) return "—";
	return channel.display;
}

/** 单位后缀：只有真实读数才配量纲（「未测量 %」是假信息）。 */
function channelUnitSuffix(channel: ScenarioDeviceChannel): string {
	if (!hasReading(channel) || channel.unit === "") return "";
	return channel.unit.length === 1 ? channel.unit : ` ${channel.unit}`;
}

/**
 * 一行摘要里的一条读数：`血氧 88%`。
 *
 * 单位跟着数字（单字符单位如 `%` 不留空格，其余按行文习惯留一个）——它是读数的量纲，
 * 不是第二个字段；数值照旧取后端的 `display`，缺失照旧是 `—`/`未测量`。
 */
function channelSummary(channel: ScenarioDeviceChannel): string {
	return `${channel.label} ${channelDisplay(channel)}${channelUnitSuffix(channel)}`;
}

/** 时间点定位：页面给了 `onLocateTurn` 就是按钮，没给就是纯文本（信息一样在）。 */
function TurnLocator({
	turn,
	onLocateTurn,
}: {
	turn: number;
	onLocateTurn?: (turn: number) => void;
}) {
	if (onLocateTurn === undefined) {
		return <span className="sc-locate">时间单位 {turn}</span>;
	}
	return (
		<button
			type="button"
			className="sc-locate"
			onClick={() => onLocateTurn(turn)}
		>
			时间单位 {turn}
		</button>
	);
}

function Channel({
	channel,
	onLocateTurn,
}: {
	channel: ScenarioDeviceChannel;
	onLocateTurn?: (turn: number) => void;
}) {
	const history = channel.history ?? [];
	const measured = channel.measured !== false && channel.value !== null && channel.value !== undefined;
	// 未测量/无数值：不显示变化量、不画趋势、不给更新时间——那些都需要一次真实测量
	const updatedTurn = measured ? (channel.updated_turn ?? null) : null;
	const status = shownStatus(channel);
	return (
		<div
			className="sc-device-channel"
			data-channel={channel.ref}
			data-status={status}
			data-measured={channel.measured === false ? "false" : "true"}
			data-attention={status === "critical" ? "critical" : undefined}
			title={CHANNEL_STATUS_LABEL[status] ?? status}
		>
			<span className="sc-device-channel-label">{channel.label}</span>
			<span className="sc-device-value">{channelDisplay(channel)}</span>
			{hasReading(channel) && channel.unit !== "" && (
				<span className="sc-device-unit">{channel.unit}</span>
			)}
			{measured && channel.delta !== null && channel.delta !== undefined && (
				<Delta delta={channel.delta} />
			)}
			{measured && history.length > 1 && (
				<Sparkline points={history} status={status} />
			)}
			<span className="sc-device-status">
				{CHANNEL_STATUS_LABEL[status] ?? status}
			</span>
			{updatedTurn !== null && (
				<TurnLocator turn={updatedTurn} onLocateTurn={onLocateTurn} />
			)}
		</div>
	);
}

export default function DevicePanel({
	devices,
	onLocateTurn,
}: {
	devices: ScenarioDevice[];
	/** 点读数的最近更新时间点 → 页面把它滚进视野（不传则不渲染可点时间点）。 */
	onLocateTurn?: (turn: number) => void;
}) {
	// 默认静音；开关是学生显式动作，偏好记在本地
	const [soundOn, setSoundOn] = useState(readSoundEnabled);
	/**
	 * 窄屏默认收成一行摘要（纵向空间留给对话流）。默认值来自视口，
	 * 之后**只按学生自己的开合**走：展开一次就一直摊着，不会因为重渲染被改回去。
	 */
	const narrow = useNarrowScreen();
	const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
	// 没有通道的设备不成卡片（一个只有标题、什么都没有的壳不是读数）
	const shownDevices = devices.filter(
		(device) => (device.channels ?? []).length > 0,
	);
	const statuses = shownDevices.flatMap((device) =>
		(device.channels ?? []).map((channel) => shownStatus(channel)),
	);
	useDeviceSound(soundOn, statuses);

	if (shownDevices.length === 0) return null;
	const anyBeep = shownDevices.some((device) => device.sound === "beep");

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

			{shownDevices.map((device) => {
				const channels = device.channels ?? [];
				const expanded = expandedById[device.id] ?? !narrow;
				const summary = channels.map(channelSummary).join(" · ");
				const worst = worstStatus(channels.map((channel) => shownStatus(channel)));
				const worstLabel =
					worst === null ? "" : (CHANNEL_STATUS_LABEL[worst] ?? worst);
				const channelsId = `sc-device-${device.id}-channels`;
				return (
					<div
						className="sc-device"
						key={device.id}
						data-device={device.id}
						data-device-kind={device.kind}
						data-expanded={expanded}
					>
						{/* 标题即开合开关：桌面只是一行标题，窄屏它是"摘要 → 全通道"的入口 */}
						<button
							type="button"
							className="sc-device-toggle"
							aria-expanded={expanded}
							aria-controls={channelsId}
							aria-label={
								worstLabel === ""
									? `${device.title}：${summary}`
									: `${device.title}：${summary}（${worstLabel}）`
							}
							onClick={() =>
								setExpandedById((current) => ({
									...current,
									[device.id]: !expanded,
								}))
							}
						>
							<span className="sc-device-title">
								<span>{device.title}</span>
								{/* 电话不是实时波形：不给折线，只列条目 */}
								<span className="sc-device-kind">
									{device.kind === "monitor"
										? "实时"
										: device.kind === "phone"
											? "通话"
											: ""}
								</span>
							</span>
							{/* 摘要只服务窄屏（样式里 `display: none` 之外一律不出现）：
							    读屏读的是上面那句 aria-label，这里是给人扫一眼的那一行 */}
							<span className="sc-device-summary" aria-hidden="true">
								{channels.map((channel, index) => (
									<Fragment key={channel.ref}>
										{index > 0 && (
											<span className="sc-device-summary-sep">·</span>
										)}
										<span
											className="sc-device-summary-item"
											data-status={shownStatus(channel)}
										>
											{channelSummary(channel)}
										</span>
									</Fragment>
								))}
							</span>
							<IconChevronDown className="sc-device-caret" size={14} aria-hidden="true" />
						</button>
						<div className="sc-device-channels" id={channelsId}>
							{channels.map((channel) => (
								<Channel
									key={channel.ref}
									channel={channel}
									onLocateTurn={onLocateTurn}
								/>
							))}
						</div>
					</div>
				);
			})}
		</section>
	);
}
