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
import {
	groupTurns,
	isPendingPlaceholder,
	messageKindLabel,
	pendingMessage,
	phaseText,
	sourceLabel,
	studentLineLabel,
	turnAnchorId,
	type PendingStudentLine,
} from "./stream";

function openImage(image: ScenarioImage | ScenarioAsset) {
	modals.open({
		title: image.title,
		size: "lg",
		centered: true,
		children: (
			<AuthImage
				className="sc-modal-image"
				alt={("alt" in image ? image.alt : "") ?? ""}
				src={scenarioImageSrc(image.url)}
			/>
		),
	});
}

/** 声明过的图片失败是技术故障，保留身份和可重试入口。 */
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
	const [attempt, setAttempt] = useState(0);
	if (status === "error") return (
		<div className="sc-image-error" role="status">
			<span>{label}：图片加载失败</span>
			<button type="button" className="sc-btn" onClick={() => {
				setStatus(null);
				setAttempt((value) => value + 1);
			}}>重试图片</button>
		</div>
	);
	return (
		<button
			type="button"
			className="sc-asset"
			data-loaded={status === "loaded"}
			onClick={() => onOpen(image)}
		>
			<AuthImage
				key={attempt}
				alt={image.alt || image.title || ""}
				src={scenarioImageSrc(image.url)}
				onStatus={setStatus}
			/>
			<span className="sc-asset-caption">{label}</span>
		</button>
	);
}

/**
 * 对话流里的一条：学生自己的话、角色台词、旁白、以及**引擎直出**的系统消息。
 *
 * - 学生（`role === "student"`）：右对齐，标签是**可读文字**「对 2 床患者 · 行动」——
 *   对象与"尝试/说话"都读得出来，不靠图标；提交中的那条带极轻的待定态，且不写成
 *   "已完成"（`docs/scenario.md` §7.4）。同一结构与 class，只多一个 `data-pending`。
 * - 旁白（`role === "scene"`）：字幕条，无头像。
 * - 角色台词：头像 + 身份小字 + 正文；临时角色显式标注身份。
 * - 系统（`role === "system"`）：被阻止／未建模由**引擎直出**，因此一定出现在这里；
 *   它们带可读标签，不伪装成角色的判断，也不当作临床错误（§7.6）。
 */
export function ScenarioLine({
	message,
	view,
	highlight = false,
}: {
	message: ScenarioMessage;
	view: ScenarioView;
	highlight?: boolean;
}) {
	const pending = isPendingPlaceholder(message);
	const sources = message.sources ?? [];
	const source = sources.length > 0 ? sources.map(sourceLabel).join("、") : null;

	if (message.role === "student") {
		const label = studentLineLabel(message, view);
		return (
			<div
				className="sc-line"
				data-role="student"
				data-declaration={message.declaration ?? undefined}
				data-pending={pending ? "true" : undefined}
				data-highlight={highlight ? "true" : undefined}
			>
				<div className="sc-line-main">
					{label !== null && (
						<span className="sc-decl">
							{message.declaration === "act" || message.kind === "action"
								? <IconHandGrab size={14} aria-hidden="true" />
								: <IconQuote size={14} aria-hidden="true" />}
							{label}
							{pending && <span className="sc-decl-note"> · 待提交</span>}
						</span>
					)}
					<div className="sc-line-text">{message.text}</div>
				</div>
			</div>
		);
	}

	if (message.role === "system") {
		return (
			<div
				className="sc-line"
				data-role="system"
				data-kind={message.kind}
				data-highlight={highlight ? "true" : undefined}
			>
				<div className="sc-line-main">
					<span className="sc-line-who">
						{messageKindLabel(message.kind)}
					</span>
					<div className="sc-line-text">{message.text}</div>
				</div>
			</div>
		);
	}

	if (message.role === "scene") {
		return (
			<div
				className="sc-line"
				data-role="scene"
				data-kind={message.kind}
				data-highlight={highlight ? "true" : undefined}
			>
				<div className="sc-line-main">
					<span className="sc-line-who">{messageKindLabel(message.kind)}</span>
					<div className="sc-subtitle">{message.text}</div>
					{source !== null && <span className="sc-line-source">来源：{source}</span>}
				</div>
			</div>
		);
	}

	// 身份名优先用后端给的 `actor_role`：临时角色（走廊护工/广播/电话另一头）**没有 actor id**，
	// 只有 DM 写的显示名；声明角色回退到名册 role，再回退到 id。都取不到就不署名——
	// 名册里没有的名字不该由前端编一个（"某个声音"是平台口吻，不是世界里的话）。
	const role =
		message.actor_role ||
		(view.actors ?? []).find((actor) => actor.id === message.actor)?.role ||
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
			data-highlight={highlight ? "true" : undefined}
			style={{ "--sc-speaker": avatar.color } as CSSProperties}
		>
			<span className="sc-avatar">{avatar.initials}</span>
			<div className="sc-line-main">
				{role !== "" && (
					<div className="sc-line-who">
						<span className="sc-speaker-name">{role}</span>
						{message.ephemeral === true && (
							<span className="sc-actor-hint">临时出现</span>
						)}
					</div>
				)}
				<div className="sc-line-text">{message.text}</div>
				{source !== null && <span className="sc-line-source">来源：{source}</span>}
			</div>
		</div>
	);
}

interface ScenarioStageProps {
	view: ScenarioView;
	/** 提交中的**真实**阶段名（后端 `phase` 枚举）；空闲时为 `null`。 */
	phase?: string | null;
	/** 还没有权威身份的学生消息（提交中）：与权威消息同一结构，按稳定 id 接替。 */
	pending?: PendingStudentLine | null;
	/** 气泡流末尾的插槽（由页面传入，随消息一起滚动）。 */
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
	/** 时间**确实前进**了的那个时间单位：轻量高亮它的消息（纯交流不推进时间，也就没有变化可突出）。 */
	highlightTurn?: number | null;
	/** 资料/设备条目上的时间单位回到对话流（变化可追溯到来源时间点）。 */
	onLocateTurn?: (turn: number) => void;
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
 * 场景画面区：**图带 + 按时间单位分段的对话流 + 在场者 + 设备**。
 *
 * 对话流按**时间单位**分段（不是最近 N 条）：同一时间单位内的多条消息属于同一个时间点，
 * 学生向上回看时正在读的那一段不会被新回应挤掉；每段带定位标记，资料栏里的时间点可以定位回来
 * （`docs/scenario.md` §7.5；`turn` 是情境时间单位，不是提交次数）。
 *
 * 图是固定高度的一条图带，文字在它**下面**的普通表面上：文字因此始终压在主题底色上，
 * 亮/暗两套主题都自然。没有图就**没有图带**：不占位、不造假图；**已声明但加载失败**的图
 * 给出失败说明与重试，不把技术故障说成"场景里没有这张图"（§7.5）。
 */
export default function ScenarioStage({
	view,
	phase = null,
	pending = null,
	optionSlot,
	showResources = false,
	actorStrip = "all",
	highlightTurn = null,
	onLocateTurn,
}: ScenarioStageProps) {
	const images = view.images ?? [];
	const mainImage = images[0];
	const extraImages = images.slice(1);
	const assets = view.assets ?? [];
	const turns = groupTurns(view.messages);
	const pendingLine = pending === null ? null : pendingMessage(pending, view);
	// 学生控制台里，可搭话的人已经是输入条旁的 chip：这里只列**没进 chip 的人**（看得见、碰不着）。
	const allActors = view.actors ?? [];
	const listedActors =
		actorStrip === "all"
			? allActors
			: allActors.filter((actor) => !presenceInteractive(actor.presence));

	// 新消息到达时自动滚到底；学生自己向上翻阅时**不抢滚动**（回到底部才恢复跟随）。
	const linesRef = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	const [newResponse, setNewResponse] = useState(false);
	// 接续只按稳定身份：消息 id 与待定请求身份，不按文案或猜测时间点去重。
	const beatSignal = `${(view.messages ?? []).length}|${view.session.turn}|${pending?.requestId ?? ""}|${optionSlot ? 1 : 0}`;
	useEffect(() => {
		const el = linesRef.current;
		if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
		else if (el) setNewResponse(true);
	}, [beatSignal]);

	/**
	 * 对话流这一块的**盒子变高变矮也要重新钉底**：分段之间的重排（缩略图落位、字体换装、
	 * 选项条折行、窄屏收薄设备卡）都会改它的可用高度，而 `beatSignal` 不一定会变。
	 */
	useEffect(() => {
		const el = linesRef.current;
		if (el === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (pinnedRef.current) el.scrollTop = el.scrollHeight;
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const handleLinesScroll = (event: UIEvent<HTMLDivElement>) => {
		const el = event.currentTarget;
		pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
		if (pinnedRef.current) setNewResponse(false);
	};

	const [mainImageFailed, setMainImageFailed] = useState(false);
	const [mainImageAttempt, setMainImageAttempt] = useState(0);
	const devices = view.devices ?? [];
	const withImage = mainImage !== undefined && !mainImageFailed;
	const place = view.situation.place;
	const timeHint = view.situation.time_hint;
	const resources = view.situation.resources ?? [];
	const resourcesLine =
		showResources && resources.length > 0 ? resourceLine(resources) : null;

	// 场景带那一行是**一句事实陈述**：地点 · 时间 · 手边有什么。
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
				/* 组=分隔符 + 资源：窄屏整组不显示（那里只留地点与时间，不留截断的尾巴） */
				<span className="sc-stage-extras">
					<span className="sc-stage-sep" aria-hidden="true">
						·
					</span>
					<span className="sc-stage-res" title={resources.join("、")}>
						{resourcesLine}
					</span>
				</span>
			)}
		</div>
	);

	return (
		<div className="sc-scene" data-devices={devices.length > 0}>
			<section className="sc-stage" aria-label="场景画面">
				{withImage ? (
					<div className="sc-stage-visual">
						<AuthImage
							key={`${mainImage.url}-${mainImageAttempt}`}
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
				{mainImage && mainImageFailed && (
					<div className="sc-image-error" role="status">
						<span>{mainImage.title}：图片加载失败，并非场景中没有此图片。</span>
						<button type="button" className="sc-btn" onClick={() => {
							setMainImageFailed(false);
							setMainImageAttempt((value) => value + 1);
						}}>重试图片</button>
					</div>
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

					<div className="sc-lines" ref={linesRef} onScroll={handleLinesScroll}>
						{turns.map((group) => (
							<div
								className="sc-turn"
								data-turn={group.turn}
								id={turnAnchorId(group.turn)}
								key={group.turn}
							>
								<div className="sc-turn-mark">
									<span>时间单位 {group.turn}</span>
								</div>
								{group.messages.map((message) => (
									<ScenarioLine
										key={message.id}
										message={message}
										view={view}
										highlight={highlightTurn === group.turn}
									/>
								))}
							</div>
						))}
						{pendingLine !== null && (
							<div className="sc-turn" data-turn={pendingLine.turn} data-pending="true">
								<ScenarioLine message={pendingLine} view={view} />
							</div>
						)}
						{phase !== null && (
							<div className="sc-streaming" role="status">
								<span className="sc-streaming-dot" aria-hidden="true" />
								<span className="sc-streaming-text">{phaseText(phase)}</span>
							</div>
						)}
						{optionSlot}
					</div>
					{newResponse && <button type="button" className="sc-btn sc-new-response" onClick={() => {
						const el = linesRef.current;
						if (el) el.scrollTop = el.scrollHeight;
						pinnedRef.current = true;
						setNewResponse(false);
					}}>有新回应 · 回到最新</button>}
				</div>

				{/* 在场者条：只读列出**没进输入条 chip 的人**（学生控制台）或全列（回放）。 */}
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
							<AssetThumb
								key={`${image.asset_id}-${index}`}
								image={image}
								label={image.title || image.asset_id}
								onOpen={openImage}
							/>
						))}
					</div>
				)}
			</section>

			<DevicePanel devices={devices} onLocateTurn={onLocateTurn} />
		</div>
	);
}
