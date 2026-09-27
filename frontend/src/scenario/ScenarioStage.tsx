import { modals } from "@mantine/modals";
import { type CSSProperties, type UIEvent, useEffect, useRef, useState } from "react";
import {
	type ScenarioActor,
	type ScenarioAsset,
	type ScenarioImage,
	type ScenarioMessage,
	type ScenarioView,
	scenarioImageSrc,
} from "@/api/scenario";
import AuthImage, { type AuthImageStatus } from "@/components/ui/auth-image";
import { presenceHint, presenceInteractive } from "./actors";
import DevicePanel from "./DevicePanel";
import { avatarFor } from "./avatar";

function openImage(image: ScenarioImage | ScenarioAsset) {
	modals.open({
		title: image.title || "场景图",
		size: "lg",
		centered: true,
		children: (
			<AuthImage
				className="sc-modal-image"
				alt={"alt" in image ? image.alt : ""}
				src={scenarioImageSrc(image.url)}
			/>
		),
	});
}

function isGeneratedImage(image: ScenarioImage | ScenarioAsset): boolean {
	if ("origin" in image) return image.origin === "generated";
	return image.id.startsWith("gen:");
}

/**
 * 场景缩略图：**拿不到字节就整块消失**（与设备面"空即不渲染"同一口径）。
 *
 * `AuthImage` 失败时只返回 `null`，如果外面还留着一个固定尺寸的按钮，学生看到的就是一个
 * 空框——所以这里按加载状态决定要不要渲染按钮本身。
 */
function AssetThumb({
	image,
	label,
	onOpen,
}: {
	image: ScenarioImage | ScenarioAsset;
	label: string;
	onOpen: (image: ScenarioImage | ScenarioAsset) => void;
}) {
	const [status, setStatus] = useState<AuthImageStatus | null>(null);
	// 取不到字节：**不留空框、不显示破图**。
	// - pack 自带的图失败：整块消失（它是可选装饰，没必要占位）；
	// - 生成图（`gen:*`）：给一句"该图已被清理"——它是**运行期产物**，
	//   删掉后旧引用会 404，学生需要知道"这里本来有张图"，而不是以为界面坏了。
	if (status === "error") {
		if (!isGeneratedImage(image)) return null;
		return (
			<div className="sc-asset sc-asset-gone">
				<span className="sc-asset-caption">该图已被清理</span>
			</div>
		);
	}
	return (
		<button
			type="button"
			className="sc-asset"
			data-loaded={status === "loaded"}
			onClick={() => onOpen(image)}
		>
			<AuthImage
				alt={image.alt || image.title}
				src={scenarioImageSrc(image.url)}
				onStatus={setStatus}
			/>
			<span className="sc-asset-caption">{label}</span>
		</button>
	);
}

/** 台词 / 旁白：旁白走字幕条样式，角色台词带派生头像与身份标签。 */
export function ScenarioLine({
	message,
	view,
}: {
	message: ScenarioMessage;
	view: ScenarioView;
}) {
	if (message.role === "scene") {
		return (
			<div className="sc-line" data-role="scene">
				<div className="sc-line-main">
					<div className="sc-subtitle">{message.text}</div>
				</div>
			</div>
		);
	}
	// 身份名优先用后端给的 `actor_role`：临时角色（走廊护工/广播/电话另一头）**没有 actor id**，
	// 只有 DM 写的显示名；声明角色回退到名册 role，再回退到 id。
	const role =
		message.actor_role ||
		view.actors.find((actor) => actor.id === message.actor)?.role ||
		message.actor ||
		"某个声音";
	const avatar = avatarFor(
		message.avatar_seed || message.actor_role || message.actor || "",
		role,
	);
	return (
		<div
			className="sc-line"
			data-role="actor"
			data-ephemeral={message.ephemeral === true}
			style={{ "--sc-speaker": avatar.color } as CSSProperties}
		>
			<span className="sc-avatar">{avatar.initials}</span>
			<div className="sc-line-main">
				<div className="sc-line-who">
					<span className="sc-speaker-name">{role}</span>
					{message.ephemeral === true && (
						<span className="sc-eph-tag">临时</span>
					)}
					{message.origin === "entity" && (
						<span className="sc-entity-tag">独立实体</span>
					)}
				</div>
				<div className="sc-line-text">{message.text}</div>
			</div>
		</div>
	);
}

/**
 * 读数 HUD：`source === "state"` 的数值 slot 大字高对比，其余 slot 按条目/计数呈现。
 *
 * 只渲染 pack `presentation.hud` 声明过的 slot（后端投影就已过滤），
 * 且**不显示 `ref`**——`scene.spo2` 这类内部字段名是 pack 作者与判读之间的事，
 * 学生看到的是作者给这个 slot 起的名字（`label`）。
 */
export function ScenarioHud({ view }: { view: ScenarioView }) {
	if (view.hud.length === 0) return null;
	return (
		<div className="sc-hud">
			{view.hud.map((slot) => (
				<div className="sc-hud-slot" data-source={slot.source} key={slot.slot}>
					<div className="sc-hud-label">{slot.label ?? slot.slot}</div>
					{slot.source === "state" ? (
						<div className="sc-hud-value">
							{slot.value === null || slot.value === undefined
								? "—"
								: String(slot.value)}
						</div>
					) : slot.source === "affordance" ? (
						<div className="sc-hud-value">{slot.count ?? 0}</div>
					) : (
						<div className="sc-hud-list">
							{(slot.items ?? []).length > 0 ? slot.items?.join("、") : "—"}
						</div>
					)}
				</div>
			))}
		</div>
	);
}

interface ScenarioStageProps {
	view: ScenarioView;
	/** 点在场者 = 预填自由通道。**不给**（管理侧回放）时在场者条只读。 */
	onTalkTo?: (actor: ScenarioActor) => void;
	/** 这一回合正在流式生成：字幕条末尾给一个细进度点（静态，不遮内容、不抖布局）。 */
	streaming?: boolean;
}

/**
 * 场景画面区（hero）：主位图 + 字幕/台词 + 在场者条 + 资源缩略图条。
 *
 * 没有图就**没有图**：不占位、不造假图（AI 绘画者未接入时后端根本不会给 `generated`）。
 * `images[]` 是"这一回合被展示的图"，第一张是主位图（带 caption），其余按缩略图挂在下面。
 */
export default function ScenarioStage({
	view,
	onTalkTo,
	streaming = false,
}: ScenarioStageProps) {
	const images = view.images ?? [];
	const mainImage = images[0];
	const extraImages = images.slice(1);
	const assets = view.assets ?? [];
	// 画面区只保留最近几个 beat：更早的内容在经历时间线里，不在这里堆成聊天记录
	const beats = view.messages.slice(-5);

	// 新消息到达时自动滚到底；学生自己向上翻阅时**不抢滚动**（回到底部才恢复跟随）。
	const linesRef = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	const beatSignal = `${view.messages.length}|${view.session.turn}`;
	useEffect(() => {
		const el = linesRef.current;
		if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
	}, [beatSignal]);

	const handleLinesScroll = (event: UIEvent<HTMLDivElement>) => {
		const el = event.currentTarget;
		pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
	};

	const [mainImageFailed, setMainImageFailed] = useState(false);
	const devices = view.devices ?? [];

	return (
		<div className="sc-scene" data-devices={devices.length > 0}>
			<section className="sc-stage" aria-label="场景画面">
				{mainImage && (
					<div className="sc-stage-visual">
						<AuthImage
							alt={mainImage.alt || mainImage.title}
							src={scenarioImageSrc(mainImage.url)}
							onStatus={(status) => setMainImageFailed(status === "error")}
						/>
						<div className="sc-stage-scrim" />
					</div>
				)}
				<div className="sc-stage-head">
					<span className="sc-stage-place">{view.situation.place}</span>
					<span className="sc-stage-time">{view.situation.time_hint}</span>
				</div>

				<div className="sc-stage-body">
					{mainImageFailed && isGeneratedImage(mainImage) && (
						<div className="sc-caption" data-kind="gone">
							这张图已被清理
						</div>
					)}
					{(mainImage?.caption || mainImage?.origin === "generated") && (
						<div className="sc-caption">
							{mainImage?.caption}
							{mainImage?.origin === "generated" && (
								<span className="sc-gen-tag">AI 生成</span>
							)}
						</div>
					)}
					{streaming && (
						<div className="sc-streaming" role="status">
							<span className="sc-streaming-dot" aria-hidden="true" />
							<span className="sc-streaming-text">正在生成…</span>
						</div>
					)}
					<div
						className="sc-lines"
						ref={linesRef}
						onScroll={handleLinesScroll}
					>
						{beats.map((message, index) => (
							<ScenarioLine
								key={`${message.turn ?? "x"}-${index}-${message.text.slice(0, 8)}`}
								message={message}
								view={view}
							/>
						))}
					</div>
				</div>

				<div className="sc-actors">
					{view.actors.map((actor) => {
						const clickable =
							onTalkTo !== undefined && presenceInteractive(actor.presence);
						const body = (
							<>
								<span className="sc-actor-dot" />
								<span>{actor.role}</span>
								<span className="sc-actor-hint">
									{presenceHint(actor.presence)}
								</span>
							</>
						);
						// `inaccessible`（不在视野）与只读回放**不给按钮**：看得到不等于碰得着。
						return clickable ? (
							<button
								key={actor.id}
								type="button"
								className="sc-actor"
								data-presence={actor.presence}
								onClick={() => onTalkTo(actor)}
							>
								{body}
							</button>
						) : (
							<span
								key={actor.id}
								className="sc-actor"
								data-presence={actor.presence}
								data-static="true"
							>
								{body}
							</span>
						);
					})}
				</div>

				{extraImages.length > 0 && (
					<div className="sc-assets">
						{extraImages.map((image, index) => (
							<button
								key={`${image.asset_id}-${index}`}
								type="button"
								className="sc-asset"
								onClick={() => openImage(image)}
							>
								<AuthImage
									alt={image.alt || image.title}
									src={scenarioImageSrc(image.url)}
								/>
								<span className="sc-asset-caption">
									{image.title || image.asset_id}
								</span>
							</button>
						))}
					</div>
				)}
			</section>

			{/* 设备是处境的一部分：紧贴画面（桌面与画面并列，窄屏折成一行紧凑读数）。
			    `devices` 为空时 DevicePanel 自己返回 null —— 不占位、不留空档。 */}
			<DevicePanel devices={devices} />

			{/* 缩略图与 HUD 属于"画面之下的一栏"：双栏时留在左列，不被挤进仪器那条窄栏 */}
			<div className="sc-scene-below">
				{assets.length > 0 && (
					<section className="sc-assets" aria-label="情境图片">
						{assets.map((asset) => (
							<AssetThumb
								key={asset.id}
								image={asset}
								label={asset.title || asset.id}
								onOpen={openImage}
							/>
						))}
					</section>
				)}

			<ScenarioHud view={view} />
			</div>
		</div>
	);
}
