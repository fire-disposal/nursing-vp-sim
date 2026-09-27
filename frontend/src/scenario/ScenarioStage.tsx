import { modals } from "@mantine/modals";
import { IconHandGrab, IconQuote } from "@tabler/icons-react";
import {
	type CSSProperties,
	type ReactNode,
	type UIEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type ScenarioAsset,
	type ScenarioImage,
	type ScenarioMessage,
	type ScenarioView,
	scenarioImageSrc,
} from "@/api/scenario";
import AuthImage, { type AuthImageStatus } from "@/components/ui/auth-image";
import { PRESENCE_HINT, presenceInteractive } from "./actors";
import { avatarFor } from "./avatar";
import DevicePanel from "./DevicePanel";

function openImage(image: ScenarioImage | ScenarioAsset) {
	modals.open({
		title: image.title,
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

/**
 * 场景缩略图：**拿不到字节就整块消失**（与设备面"空即不渲染"同一口径）。
 *
 * `AuthImage` 失败时只返回 `null`，如果外面还留着一个固定尺寸的按钮，学生看到的就是一个
 * 空框——所以这里按加载状态决定要不要渲染按钮本身。图没了就**不留占位、不留说明句**：
 * 界面里没有它，就是世界里没有它。
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
	if (status === "error") return null;
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

/**
 * 台词 / 旁白 / 学生自己的话。
 *
 * 旁白（`role === "scene"`）走字幕条：**没有头像、单列铺满**（样式见
 * `scenario.css` 的 `.sc-line[data-role="scene"]`；少了那条规则，唯一的子元素会落进
 * 头像那一列，中文每行只剩一个字）。
 * 角色台词走"头像 + 身份小字 + 正文"三层：身份名是次级小字，颜色只落在头像上
 * （说话人分色因此不会牺牲正文对比度）。
 * 学生自己（`role === "student"`）**右对齐**、只靠 1px 边与底色跟旁白/台词分层——
 * 不加头像、不写"你"：他就是这一侧的人，不需要再自我介绍。
 * `pending`（前端标记，后端不返回）= 学生刚提交、权威视图还没到的那一句：**同一个结构与 class**，
 * 只多一个极轻的待定态（见 `scenario.css`），不加"发送中…"这类世界里不存在的话。
 */
export function ScenarioLine({
	message,
	view,
}: {
	message: ScenarioMessage;
	view: ScenarioView;
}) {
	if (message.role === "student") {
		// 声明（说话 / 行动）只体现在**形态**上：一个极小的引号或手，不写"你说：""执行："这类平台口吻。
		const declaration = message.declaration ?? null;
		return (
			<div
				className="sc-line"
				data-role="student"
				data-declaration={declaration ?? undefined}
				data-pending={message.pending === true ? "true" : undefined}
			>
				<div className="sc-line-main">
					{declaration !== null && (
						<span className="sc-decl" aria-hidden="true">
							{declaration === "say" ? (
								<IconQuote size={12} />
							) : (
								<IconHandGrab size={12} />
							)}
						</span>
					)}
					<div className="sc-line-text">{message.text}</div>
				</div>
			</div>
		);
	}
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
	// 只有 DM 写的显示名；声明角色回退到名册 role，再回退到 id。都取不到就不署名——
	// 名册里没有的名字不该由前端编一个（"某个声音"是平台口吻，不是世界里的话）。
	const role =
		message.actor_role ||
		view.actors.find((actor) => actor.id === message.actor)?.role ||
		message.actor ||
		"";
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
				{role !== "" && (
					<div className="sc-line-who">
						<span className="sc-speaker-name">{role}</span>
					</div>
				)}
				<div className="sc-line-text">{message.text}</div>
			</div>
		</div>
	);
}

/**
 * 读数 HUD：只保留 pack 声明里的**仪器读数**（`source === "state"`）——等宽数字、右对齐。
 *
 * 其余 source（`cue` / `actor` / `affordance`）是**同一事实的第二处**：现场线索与"你注意到的"
 * 在白板上、在场者在在场者条上、"能做什么"是能力清单（默认视野里不该出现）。
 * 所以它们不再在读数区重复一遍；一个 `state` slot 都没有时整块不渲染（不留空壳）。
 *
 * 且**不显示 `ref`**：`scene.spo2` 这类内部字段名是 pack 作者与判读之间的事，
 * 学生看到的是作者给这个 slot 起的名字（`label`）。
 */
export function ScenarioHud({ view }: { view: ScenarioView }) {
	const slots = view.hud.filter((slot) => slot.source === "state");
	if (slots.length === 0) return null;
	return (
		<div className="sc-hud">
			{slots.map((slot) => (
				<div className="sc-hud-slot" data-source={slot.source} key={slot.slot}>
					<div className="sc-hud-label">{slot.label ?? slot.slot}</div>
					<div className="sc-hud-value">
						{slot.value === null || slot.value === undefined
							? "—"
							: String(slot.value)}
					</div>
				</div>
			))}
		</div>
	);
}

interface ScenarioStageProps {
	view: ScenarioView;
	/** 这一回合正在流式生成：台词流末尾给一个细进度标记（静态，不遮内容、不抖布局）。 */
	streaming?: boolean;
	/** 气泡流末尾的插槽：DM 此刻给的选项条（由页面传入，随消息一起滚动）。 */
	optionSlot?: ReactNode;
	/** 是否在场景带那一行里续上"手边有什么"。由 pack 声明的 panels 决定。 */
	showResources?: boolean;
	/**
	 * 在场者条列谁：
	 * - `all`（默认，管理侧回放）：全列、只读——回放没有输入条，这里是唯一的名册；
	 * - `unaddressable`（学生控制台）：**搭得上话的人已经在输入条旁的 chip 里**，
	 *   这里只补"看得见、碰不着"的人（`inaccessible`），免得他们从界面上消失。
	 */
	actorStrip?: "all" | "unaddressable";
}

/** 手边有 >4 样东西就截断（全量在 `title` 里）：场景那一行是陈述，不是清单。 */
const RESOURCE_PREVIEW = 4;

/** 「手边有：值班手机、院内系统…」——一句叙事内的事实陈述，不是表单字段。 */
function resourceLine(resources: string[]): string {
	const shown = resources.slice(0, RESOURCE_PREVIEW);
	const rest = resources.length - shown.length;
	return `手边有：${shown.join("、")}${rest > 0 ? ` 等 ${resources.length} 样` : ""}`;
}

/**
 * 场景画面区：**图带 + 字幕/台词 + 在场者 + 资源缩略图**。
 *
 * 图是固定高度的一条图带，文字在它**下面**的普通表面上：文字因此始终压在主题底色上，
 * 亮/暗两套主题都自然（不需要把整块画面染黑）。没有图就**没有图带**：不占位、不造假图。
 * 地点/时间/手边有什么写在场景带那一行里（一句事实陈述），不另开一行挂名词。
 */
export default function ScenarioStage({
	view,
	streaming = false,
	optionSlot,
	showResources = false,
	actorStrip = "all",
}: ScenarioStageProps) {
	const images = view.images ?? [];
	const mainImage = images[0];
	const extraImages = images.slice(1);
	const assets = view.assets ?? [];
	// 画面区只保留最近几个 beat：更早的内容在经历时间线里，不在这里堆成聊天记录
	const beats = view.messages.slice(-5);
	// 学生控制台里，可搭话的人已经是输入条旁的 chip：这里只列**没进 chip 的人**（看得见、碰不着）。
	const listedActors =
		actorStrip === "all"
			? view.actors
			: view.actors.filter((actor) => !presenceInteractive(actor.presence));

	// 新消息到达时自动滚到底；学生自己向上翻阅时**不抢滚动**（回到底部才恢复跟随）。
	const linesRef = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	const beatSignal = `${view.messages.length}|${view.session.turn}|${optionSlot ? 1 : 0}`;
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
	const withImage = mainImage !== undefined && !mainImageFailed;
	const place = view.situation.place;
	const timeHint = view.situation.time_hint;
	const resources = view.situation.resources;
	const resourcesLine =
		showResources && resources.length > 0 ? resourceLine(resources) : null;

	// 场景带那一行是**一句事实陈述**：地点 · 时间 · 手边有什么。
	// 资源不再是对话流下缘一串没头没脑的名词——它属于"场景"，就写在场景那一行里。
	const stageHead = (
		<div className="sc-stage-head" data-plain={withImage ? undefined : "true"}>
			<span className="sc-stage-place">{place}</span>
			{timeHint !== "" && (
				<>
					<span className="sc-stage-sep" aria-hidden="true">
						·
					</span>
					<span className="sc-stage-time">{timeHint}</span>
				</>
			)}
			{resourcesLine !== null && (
				<>
					<span className="sc-stage-sep" aria-hidden="true">
						·
					</span>
					<span className="sc-stage-res" title={resources.join("、")}>
						{resourcesLine}
					</span>
				</>
			)}
		</div>
	);

	return (
		<div className="sc-scene" data-devices={devices.length > 0}>
			<section className="sc-stage" aria-label="场景画面">
				{withImage ? (
					<div className="sc-stage-visual">
						<AuthImage
							alt={mainImage.alt || mainImage.title}
							src={scenarioImageSrc(mainImage.url)}
							onStatus={(status) => setMainImageFailed(status === "error")}
						/>
						<div className="sc-stage-scrim" />
						{stageHead}
					</div>
				) : (
					stageHead
				)}

				<div className="sc-stage-body">
					{/* 情境图片与读数都属于"场景"这一层：紧贴场景带，不做对话流旁边的孤立块 */}
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

					{mainImage?.caption && (
						<div className="sc-caption">{mainImage.caption}</div>
					)}

					<ScenarioHud view={view} />

					<div className="sc-lines" ref={linesRef} onScroll={handleLinesScroll}>
						{beats.map((message, index) => (
							<ScenarioLine
								key={`${message.turn ?? "x"}-${index}-${message.text.slice(0, 8)}`}
								message={message}
								view={view}
							/>
						))}
						{streaming && (
							<div className="sc-streaming" role="status">
								<span className="sc-streaming-dot" aria-hidden="true" />
								<span className="sc-streaming-text">正在生成…</span>
							</div>
						)}
						{optionSlot}
					</div>
				</div>

				{/* 在场者条：只读列出**没进输入条 chip 的人**（学生控制台）或全列（回放）。
				    可搭话的人在输入条旁选；这里出现的人就是"看得见、此刻说不上话"的那些。 */}
				{listedActors.length > 0 && (
					<div className="sc-actors">
						{listedActors.map((actor) => {
							const hint = PRESENCE_HINT[actor.presence] ?? actor.presence;
							return (
								<span
									key={actor.id}
									className="sc-actor"
									data-presence={actor.presence}
									data-static="true"
								>
									<span className="sc-actor-dot" />
									<span>{actor.role}</span>
									{hint !== "" && <span className="sc-actor-hint">{hint}</span>}
								</span>
							);
						})}
					</div>
				)}

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
		</div>
	);
}
