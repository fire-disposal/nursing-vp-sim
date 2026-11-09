import { Box, Group, Text } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ClinicalChatLine } from "./chat-lines";
// CC0：Summer Engine，ALEX neutre（半写实成年男性位图）。
// https://www.summerengine.com/asset-store/alex-neutre-f312e43f
import patientPortrait from "./assets/patient-asthma.webp";
import wardNight from "./assets/ward-night.svg";

/**
 * 主舞台：**视觉小说式床旁现场**。
 *
 * 构图（自下而上叠放，画面本身占主要视觉面积）：
 * - 背景：夜班观察室的空镜（本地 SVG）；
 * - 立绘：患者坐在床边（本地 SVG，透明底，压在背景上、站在"地面"线上）；
 * - 抬头：床边状态点 + 病例名 + 倒计时，压在画面之上不占版式高度；
 * - 对话框：覆盖在舞台下部，放患者**最新一句**（视觉小说的主读区）；
 * - 完整历史：对话框上方一个可展开的滚动实录 —— 最新一句被突出，但历史永远可达
 *   （训练需要回看患者说过的每一句，不能只剩一句）。
 *
 * 两张图都是静态资产，只在加载失败时退化为文字说明；没有持续动画。
 */
export function PatientStage({
	lines,
	caseName,
	sending,
	linkedMessageId,
	linkAnchorRef,
	onFocusMessage,
	clock,
	expired,
}: {
	lines: ClinicalChatLine[];
	caseName: string;
	sending: boolean;
	linkedMessageId: number | null;
	linkAnchorRef: RefObject<HTMLDivElement | null>;
	onFocusMessage: (messageId: number) => void;
	/** 剩余时间文本（`--:--` = 不限时）。 */
	clock: string;
	expired: boolean;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);
	const [historyOpen, setHistoryOpen] = useState(false);
	const latestPatient = [...lines].reverse().find((line) => line.role === "patient");

	const lastKey = lines.length > 0 ? lines[lines.length - 1].key : "";
	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		// 首次展开就定位到最新一条；之后只有"本来就在底部"时才跟随。
		if (!historyOpen || !stickRef.current) return;
		viewport.scrollTop = viewport.scrollHeight;
	}, [lastKey, historyOpen]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const onScroll = () => {
			const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
			stickRef.current = distance < 40;
		};
		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, []);

	const patientTurns = lines.filter((line) => line.role === "patient").length;

	return (
		<Box
			component="section"
			className="cr-stage"
			aria-label="床旁现场"
			style={{ display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}
		>
			{/* ── 舞台画面：背景 + 立绘，占主舞台绝大部分面积 ─────────────
			    背景与立绘都是本地静态 SVG（Vite import）。任一张加载失败时，用可读的文字
			    兜底（不出现空框），因为这是"现场"，不是装饰。 */}
			<Box className="cr-stage-art">
				<img
					className="cr-stage-bg"
					src={wardNight}
					alt=""
					aria-hidden
					decoding="async"
					onError={(event) => {
						event.currentTarget.dataset.broken = "true";
					}}
				/>
				<Box className="cr-stage-figure">
					<img
						className="cr-stage-char"
						src={patientPortrait}
						alt="青年男性患者，神情疲惫"
						decoding="async"
						onError={(event) => {
							event.currentTarget.style.display = "none";
							const fallback = event.currentTarget.nextElementSibling;
							if (fallback instanceof HTMLElement) fallback.hidden = false;
						}}
					/>
					{/* 立绘加载失败时的文字兜底：仍然是"一个坐在床边的人"，而不是空白 */}
					<Box className="cr-figure-fallback" hidden aria-hidden>
						<Box className="cr-figure-fallback-mark" />
						<Text size="xs">
							患者端坐于床边，上身前倾、双手撑膝，张口费力呼吸
						</Text>
					</Box>
				</Box>
				{/* 立绘底部与地面衔接的阴影，让"站在床边"成立 */}
				<Box className="cr-stage-ground" aria-hidden />
			</Box>

			{/* 现场抬头压在画面之上（不占版式高度） */}
			<Group
				className="cr-stage-hud"
				justify="space-between"
				align="center"
				wrap="nowrap"
				gap="sm"
				px="md"
			>
				<Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
					<Box
						className="cr-presence"
						data-state={sending ? "speaking" : "idle"}
						role="status"
						aria-live="polite"
					>
						<Box className="cr-presence-dot" aria-hidden />
						{sending ? "患者正在回应" : "床边 · 夜间病区"}
					</Box>
					{caseName && (
						<Text size="xs" className="cr-stage-hud-dim" truncate>
							{caseName}
						</Text>
					)}
				</Group>
				<Group gap={5} wrap="nowrap" c={expired ? "var(--ns-danger)" : "var(--ns-ink-soft)"}>
					<IconClock size={13} aria-hidden />
					<Text size="xs" fw={650} aria-label={clock === "--:--" ? "不限时" : `剩余时间 ${clock}`}>
						{clock}
					</Text>
				</Group>
			</Group>

			{/* ── 视觉小说对话框：覆盖在舞台下部，放患者最新一句 ──────────
			    完整历史不被藏起来：对话框上方有"对话记录 N 条"，展开就是可滚动的实录。 */}
			<Box className="cr-dialogue-wrap">
				{historyOpen && (
					<Box
						id="cr-conversation-history"
						className="cr-history cr-scroll"
						role="log"
						aria-label="完整对话记录"
						ref={viewportRef}
					>
						{lines.length === 0 ? (
							<Text size="sm" c="var(--ns-ink-dim)">
								还没有对话。
							</Text>
						) : (
							<Box className="cr-ledger">
								{lines.map((line) => {
									const linked =
										linkedMessageId !== null && line.messageId === linkedMessageId;
									const focusTarget =
										linked && line.messageId !== null ? { id: line.messageId } : null;
									return (
										<Box
											key={line.key}
											ref={linked ? linkAnchorRef : undefined}
											className="cr-turn"
											data-role={line.role}
											data-sending={line.sending || undefined}
											data-linked={linked || undefined}
											tabIndex={focusTarget ? -1 : undefined}
											onFocus={focusTarget ? () => onFocusMessage(focusTarget.id) : undefined}
										>
											<Box className="cr-turn-who">
												<Text className="cr-turn-name">
													{line.role === "student" ? "我 · 护士" : "患者"}
												</Text>
												{line.sending && (
													<Text size="xs" c="var(--ns-ink-faint)">
														送达中…
													</Text>
												)}
											</Box>
											<Text className="cr-turn-text">{line.content}</Text>
										</Box>
									);
								})}
							</Box>
						)}
					</Box>
				)}

				<Box className="cr-dialogue" data-linked={linkedMessageId !== null || undefined}>
					<Group justify="space-between" align="center" wrap="nowrap" mb={6}>
						<Text className="cr-dialogue-name">
							{sending ? "患者 · 正在说" : "患者"}
						</Text>
						<Group gap={8} wrap="nowrap">
							{lines.length > 0 && (
								<Box
									component="button"
									type="button"
									className="cr-dialogue-toggle"
									onClick={() => setHistoryOpen((open) => !open)}
									aria-expanded={historyOpen}
									aria-controls="cr-conversation-history"
								>
									{historyOpen ? "收起记录" : `对话记录 ${lines.length} 条`}
								</Box>
							)}
						</Group>
					</Group>
					<Text className="cr-dialogue-text" aria-live="polite">
						{latestPatient?.content ||
							(lines.length === 0
								? "先说明身份与来意，再开始评估。"
								: "……（等你开口）")}
					</Text>
					{patientTurns === 0 && (
						<Text className="cr-dialogue-hint">
							患者的回答会出现在这里，并成为左侧证据链上的线索。
						</Text>
					)}
				</Box>
			</Box>
		</Box>
	);
}
