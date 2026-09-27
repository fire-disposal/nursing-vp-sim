import { ActionIcon, Badge, Box, Group, Text, Textarea, Tooltip } from "@mantine/core";
import { IconBroadcast, IconLoader2, IconSend } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import type { MessageBus } from "@/engine/types";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";

/**
 * ConversationComposer — 对话通道（双工语音对谈 + 文本输入）。
 *
 * 唯一语义出口：`send(text)`。文本输入与语音转写最终都走这一条
 * 学生消息 → 现有聊天管道（SSE / 情绪 / 守卫 / 评分）全程无感。
 *
 * - text：手动输入（Enter 发送）；
 * - voice（双工，`useVoiceDialogue({ continuous: true })`）：点一次麦克风即常开聆听，
 *   停顿 `silenceMs` 判句尾自动发送，学生**不必按住**；患者还在说话/回复时学生开口
 *   → `onBargeIn()`（停播 + 取消在途生成由训练装配层负责），本句照常转写并在句尾送出。
 *   持续对谈不可用（麦克风权限被拒/浏览器限制）→ 自动降级为按住说话，并说明原因。
 *
 * 输入区三态只做**展示**推导：患者在说（tts 在播）→ 听；患者在组织语言（回复中但还没出声）→ 想；
 * 其余 → 说（学生的回合/正在说）。患者状态本身来自 store 的 `sending` 与既有 owner
 * TTSManager 发出的 `tts:start`/`tts:end` —— 前端不新增状态源。
 *
 * 后端零改动：语音端只是把转写文本当作一条学生消息发送。
 */
type ComposerMode = "text" | "voice";

/** 输入区三态：听（患者在说）/ 想（患者在组织语言）/ 说（学生的回合）。 */
type DuplexTurn = "listen" | "think" | "say";

const TURN_LABEL: Record<DuplexTurn, string> = { listen: "听", think: "想", say: "说" };
/** 遍历顺序稳定（听 → 想 → 说）。 */
const TURNS: DuplexTurn[] = ["listen", "think", "say"];

interface ConversationComposerProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
	trainingEnded?: boolean;
	/** 训练总线：消费 `tts:start`/`tts:end` 区分「患者在说」与「患者在想」。 */
	bus?: MessageBus | null;
	/** 打断出口：学生开口而患者仍在说话/回复时调用（停播 + 取消在途生成由训练装配层负责）。 */
	onBargeIn?: () => void;
}

export function ConversationComposer({
	onSend,
	disabled,
	loading,
	trainingEnded,
	bus,
	onBargeIn,
}: ConversationComposerProps) {
	const [mode, setMode] = useState<ComposerMode>("text");
	const [text, setText] = useState("");
	const [patientSpeaking, setPatientSpeaking] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const showCount = text.length >= 1600;
	const toast = useToast();

	// 「患者在说」= TTSManager 正在播放（既有 bus 事件，不新增状态源）。
	useEffect(() => {
		if (!bus) {
			setPatientSpeaking(false);
			return;
		}
		const offStart = bus.on("tts:start", () => setPatientSpeaking(true));
		const offEnd = bus.on("tts:end", () => setPatientSpeaking(false));
		return () => {
			offStart();
			offEnd();
		};
	}, [bus]);

	// 双工语音对谈：常开聆听 + 静音判句尾自动提交 + 患者说话时开口即打断。
	const voice = useVoiceDialogue({
		onSend,
		patientReplying: !!loading,
		patientSpeaking,
		autoRearm: false,
		silenceMs: 800,
		continuous: true,
		onBargeIn,
	});

	/** 持续对谈可用：点一次即常开聆听（再点关闭）；不可用则降级按住说话。 */
	const duplex = voice.supported && !voice.continuousFailed;

	// ── 三态（展示层推导，不新增状态源）──
	// 听 = 患者正在出声（TTS 播放中，含回复结束后播完最后几句的尾音——此时学生开口仍是打断）；
	// 想 = 患者回复中但还没出声（在组织语言）；打断时立刻转「说」，不等服务端状态落地。
	const turn: DuplexTurn = voice.interrupted ? "say" : patientSpeaking ? "listen" : loading ? "think" : "say";
	const capturing = voice.transcript.trim().length > 0;
	const turnColor =
		turn === "listen" ? "brand" : turn === "think" ? "gray" : voice.interrupted || capturing ? "red" : "brand";

	const turnHint = voice.interrupted
		? `已打断患者，正在听你说…${capturing ? `：${voice.transcript}` : ""}`
		: capturing
			? `正在听你说…：${voice.transcript}`
			: turn === "listen"
				? "患者在说…（你开口即可打断）"
				: turn === "think"
					? "患者在想…（你开口即可打断）"
					: "该你说话了";

	// 按住模式的旧话术（降级路径原样保留：松开自动发送）。
	const holdHint =
		voice.phase === "listening"
			? capturing
				? `正在听…：${voice.transcript}（松开自动发送）`
				: "正在听…（松开自动发送）"
			: voice.phase === "sending"
				? "正在发送…"
				: voice.phase === "ready"
					? "该你说话了"
					: "";
	const voiceHint = voice.notice ?? (duplex ? turnHint : holdHint);

	// notice 全部产生于失败/回退路径（不支持、识别失败、启动失败、发送失败），此时 phase 恰好是
	// idle —— 旧条件 `phase !== "idle"` 让这些提示永远不渲染，语音故障被静默吞掉（docs/19 E6）。
	const showVoiceStatus =
		mode === "voice" &&
		(voice.notice !== null || voice.phase !== "idle" || voice.continuousArmed || patientSpeaking || !!loading);

	// 浏览器不支持语音输入：灰色按钮仍可点，点击后弹出简洁提示（tooltip 兜底）。
	const unsupported = !voice.supported;
	const unsupportedHint = "当前浏览器不支持语音输入（建议 Chrome/Edge），可直接用文字对话";
	const micTooltip = unsupported
		? unsupportedHint
		: duplex
			? voice.continuousArmed
				? "关闭持续对谈"
				: "开启持续对谈（不必按住说话）"
			: voice.phase === "listening"
				? "松开自动发送"
				: voice.phase === "ready"
					? "该你说话了"
					: "按住说话";

	// 双工模式的麦克风必须**在患者说话时也可用**（否则无法打断，也无法取消），
	// 只由训练结束关闭；按住模式沿用旧的禁用规则。
	const micDisabled =
		trainingEnded ||
		(duplex ? false : disabled || ((loading || voice.phase === "sending") && voice.phase !== "listening"));
	const micVariant =
		duplex && voice.continuousArmed ? "filled" : voice.phase === "listening" || voice.phase === "ready" ? "filled" : "default";
	const micColor =
		duplex && voice.continuousArmed ? "red" : voice.phase === "listening" ? "red" : voice.phase === "ready" ? "brand" : undefined;
	const micStyle =
		voice.phase === "listening" || (duplex && voice.continuousArmed)
			? { touchAction: "none", boxShadow: "0 0 0 4px rgba(239,68,68,.22)" }
			: unsupported
				? { touchAction: "none", opacity: 0.5, cursor: "not-allowed" }
				: { touchAction: "none" };

	const placeholder = trainingEnded
		? "训练已结束，评分结果已生成"
		: loading
			? "患者正在回复中…"
			: mode === "voice"
				? duplex
					? voice.continuousArmed
						? "直接说话，停顿即发送（患者说话时开口可打断）"
						: "点麦克风开启持续对谈，不必按住说话"
					: "按住麦克风说话，松开自动发送"
				: "输入消息与患者对话...";

	const handleSend = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || disabled || loading) return;
		// 唯一语义出口：文本 / 语音转写 / 未来通话转写都走这里。
		onSend(trimmed);
		setText("");
		setMode("text");
		inputRef.current?.focus();
	}, [text, onSend, disabled, loading]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	// 用户一旦开始打字，切回文本模式（语音状态收起）。
	// 双工模式下必须同时**关掉常开麦克风**：否则输入区收起状态提示后麦克风还在收音，
	// 学生（或环境）说的话会被当成一条消息悄悄发出去。
	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setText(e.target.value);
			if (!e.target.value.trim()) return;
			setMode("text");
			if (duplex && voice.continuousArmed) voice.reset();
		},
		[duplex, voice],
	);

	// 按下：双工模式是开/关持续对谈（一次点击即完成麦克风手势授权），按住模式照旧开始聆听。
	const handleMicDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			if (!voice.supported) {
				// 浏览器不支持：灰色按钮仍可点，点击弹出简洁提示（不进入语音模式）。
				toast.warning(unsupportedHint);
				return;
			}
			setMode("voice");
			if (duplex) {
				if (voice.continuousArmed) voice.stop();
				else voice.start();
				return;
			}
			voice.pressStart();
		},
		[unsupportedHint, voice, duplex, toast],
	);
	// 抬手：双工模式不停（常开聆听），按住模式松开即发送。
	const handleMicUp = useCallback(() => {
		if (duplex) return;
		voice.pressEnd();
	}, [duplex, voice]);

	return (
		<Box
			className="border-t"
			style={{ borderColor: "var(--mantine-color-default-border)", background: "var(--mantine-color-body)" }}
			pb="env(safe-area-inset-bottom)"
		>
			<Group align="flex-end" gap={8} px="md" py="sm" wrap="nowrap" style={{ maxWidth: 768, margin: "0 auto", width: "100%" }}>
				<Textarea
					ref={inputRef}
					flex={1}
					miw={0}
					value={text}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					disabled={disabled || loading || trainingEnded}
					autosize
					minRows={1}
					maxRows={5}
					radius="md"
					aria-label="对话输入"
					leftSection={
						<Tooltip label={micTooltip}>
							<ActionIcon
								variant={micVariant}
								color={micColor}
								size="xl"
								radius="sm"
								disabled={micDisabled}
								onPointerDown={handleMicDown}
								onPointerUp={handleMicUp}
								onPointerLeave={handleMicUp}
								onPointerCancel={handleMicUp}
								aria-label={duplex ? "持续对谈" : "语音输入"}
								aria-pressed={duplex ? voice.continuousArmed : undefined}
								style={micStyle}
							>
								<IconBroadcast size={22} />
							</ActionIcon>
						</Tooltip>
					}
					leftSectionPointerEvents="all"
					leftSectionWidth={56}
					rightSection={
						loading ? (
							<ActionIcon variant="subtle" size="xl" radius="sm" disabled aria-label="回复中">
								<IconLoader2 size={22} className="animate-spin" />
							</ActionIcon>
						) : (
							<ActionIcon
								variant="filled"
								color="brand"
								size="xl"
								radius="sm"
								disabled={!text.trim() || disabled || trainingEnded}
								onClick={handleSend}
								aria-label="发送"
							>
								<IconSend size={22} />
							</ActionIcon>
						)
					}
					rightSectionWidth={56}
				/>
			</Group>
			{showVoiceStatus ? (
				<Box px="md" pb={4} aria-live="polite">
					<Group gap={8} justify="center" align="center" wrap="nowrap">
						<Group gap={4} wrap="nowrap" aria-label="对谈状态">
							{TURNS.map((key) => (
								<Badge
									key={key}
									size="xs"
									radius="sm"
									variant={turn === key ? "filled" : "default"}
									color={turn === key ? turnColor : undefined}
									c={turn === key ? undefined : "dimmed"}
								>
									{TURN_LABEL[key]}
								</Badge>
							))}
						</Group>
						<Text size="xs" c={voice.notice ? "red" : turnColor} truncate>
							{voiceHint}
						</Text>
					</Group>
				</Box>
			) : null}
			{showCount && (
				<Text ta="right" size="xs" c="dimmed" pr="md">
					{text.length}/2000
				</Text>
			)}
		</Box>
	);
}
