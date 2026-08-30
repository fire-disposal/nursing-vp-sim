import { ActionIcon, Box, Group, Text, Tooltip } from "@mantine/core";
import { IconBroadcast, IconLoader2, IconSend } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";

/**
 * ConversationComposer — 对话通道（半双工对讲机式语音对答 MVP）。
 *
 * 唯一语义出口：`send(text)`。文本输入与语音转写最终都走这一条
 * 学生消息 → 现有聊天管道（SSE / 情绪 / 守卫 / 评分）全程无感。
 *
 * - text：手动输入（Enter 发送）；
 * - voice：`useVoiceDialogue` —— 按住麦克风说话，松开自动发送，
 *   说完自动收尾，患者回复后自动就绪（该你说话了）。
 *
 * 后端零改动：语音端只是把转写文本当作一条学生消息发送。
 */
type ComposerMode = "text" | "voice";

interface ConversationComposerProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
	trainingEnded?: boolean;
}

export function ConversationComposer({
	onSend,
	disabled,
	loading,
	trainingEnded,
}: ConversationComposerProps) {
	const [mode, setMode] = useState<ComposerMode>("text");
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const showCount = text.length >= 1600;

	// 半双工语音对答状态机：patientReplying 由父级的 loading（sending）驱动。
	const voice = useVoiceDialogue({
		onSend,
		patientReplying: !!loading,
		autoRearm: false,
	});

	// 语音模式中的状态提示（转写中 / 患者回复中 / 该你说话了 / 错误）。
	const voiceStatus =
		voice.notice ??
		(voice.phase === "listening"
			? `正在听…${voice.transcript ? `：${voice.transcript}` : ""}（松开自动发送）`
			: voice.phase === "sending"
				? "正在发送…"
				: voice.phase === "ready"
					? "该你说话了"
					: "");

	const showVoiceStatus = mode === "voice" && voice.phase !== "idle";

	const placeholder = trainingEnded
		? "训练已结束，评分结果已生成"
		: loading
			? "患者正在回复中…"
			: mode === "voice"
				? "按住麦克风说话，松开自动发送"
				: "输入消息与患者对话...";

	const handleSend = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || disabled || loading) return;
		// 唯一语义出口：文本 / 语音转写 / 未来通话转写都走这里。
		onSend(trimmed);
		setText("");
		setMode("text");
		setTimeout(() => {
			const el = inputRef.current;
			if (el) el.style.height = "auto";
		}, 0);
		inputRef.current?.focus();
	}, [text, onSend, disabled, loading]);

	const handleInput = useCallback(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
	}, []);

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
	const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setText(e.target.value);
		if (e.target.value.trim()) setMode("text");
	}, []);

	// 松开即发送（按住说话）；离开发送区兜底。
	const handleMicDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			setMode("voice");
			voice.pressStart();
		},
		[voice],
	);
	const handleMicUp = useCallback(() => voice.pressEnd(), [voice]);

	return (
		<Box
			className="border-t"
			style={{ borderColor: "var(--mantine-color-default-border)", background: "var(--mantine-color-body)" }}
			pb="env(safe-area-inset-bottom)"
		>
			<Group
				align="flex-end"
				gap={8}
				px="md"
				py="sm"
				wrap="nowrap"
				style={{ maxWidth: 768, margin: "0 auto" }}
			>
				<Tooltip
					label={
						voice.phase === "listening"
							? "松开自动发送"
							: voice.phase === "ready"
								? "该你说话了"
								: "按住说话"
					}
				>
					<ActionIcon
						variant={voice.phase === "listening" ? "filled" : "default"}
						color={voice.phase === "listening" ? "red" : undefined}
						size="lg"
						disabled={disabled || loading || trainingEnded || !voice.supported}
						onPointerDown={handleMicDown}
						onPointerUp={handleMicUp}
						onPointerLeave={handleMicUp}
						onPointerCancel={handleMicUp}
						aria-label="语音输入"
						style={{ touchAction: "none" }}
					>
						<IconBroadcast size={18} />
					</ActionIcon>
				</Tooltip>
				<Box flex={1} miw={0}>
					<textarea
						ref={inputRef}
						value={text}
						onChange={handleChange}
						onInput={handleInput}
						onKeyDown={handleKeyDown}
						placeholder={placeholder}
						disabled={disabled || loading || trainingEnded}
						rows={1}
						aria-label="对话输入"
						style={{
							width: "100%",
							resize: "none",
							border: "none",
							outline: "none",
							background: "transparent",
							fontSize: 14,
							lineHeight: 1.5,
							maxHeight: 120,
							color: "var(--mantine-color-text)",
						}}
					/>
				</Box>
				{loading ? (
					<ActionIcon variant="subtle" size="lg" disabled aria-label="回复中">
						<IconLoader2 size={18} className="animate-spin" />
					</ActionIcon>
				) : (
					<ActionIcon
						variant="filled"
						color="brand"
						size="lg"
						disabled={!text.trim() || disabled || trainingEnded}
						onClick={handleSend}
						aria-label="发送"
					>
						<IconSend size={18} />
					</ActionIcon>
				)}
			</Group>
			{showVoiceStatus ? (
				<Text
					ta="center"
					size="xs"
					c={voice.notice ? "red" : "dimmed"}
					px="md"
					pb={4}
				>
					{voiceStatus}
				</Text>
			) : null}
			{showCount && (
				<Text ta="right" size="xs" c="dimmed" pr="md">
					{text.length}/2000
				</Text>
			)}
		</Box>
	);
}
