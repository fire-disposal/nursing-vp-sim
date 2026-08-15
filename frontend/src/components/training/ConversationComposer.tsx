import { ActionIcon, Box, Group, Text, Tooltip } from "@mantine/core";
import { IconBroadcast, IconLoader2, IconPhone, IconSend } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

/**
 * ConversationComposer — 对话通道（Phase 5-EX / ASR 预留核心）。
 *
 * 三种输入模式共用唯一语义出口：
 *   type ComposerMode = "text" | "voice" | "call";
 *   send(text: string) —— 文本 / 语音转写确认 / 未来通话转写，最终都是
 *   "学生消息文本" → 现有聊天管道（SSE/情绪/守卫/评分）全部无感。
 *
 * - voice：Web Speech API MVP（U2 复活）——转写实时进输入框，确认后 send；
 * - call：预留通话模式（CallShell，见 redesign-frontend.md §6），当前仅入口占位。
 */
type ComposerMode = "text" | "voice" | "call";

interface ConversationComposerProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
	trainingEnded?: boolean;
}

const VOICE_UNSUPPORTED_HINT = "当前浏览器不支持语音输入（建议 Chrome/Edge）";

export function ConversationComposer({
	onSend,
	disabled,
	loading,
	trainingEnded,
}: ConversationComposerProps) {
	const [mode, setMode] = useState<ComposerMode>("text");
	const [text, setText] = useState("");
	const [listening, setListening] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const recognitionRef = useRef<{ stop: () => void } | null>(null);
	const toast = useToast();
	const showCount = text.length >= 1600;

	const placeholder = trainingEnded
		? "训练已结束，评分结果已生成"
		: loading
			? "患者正在回复中…"
			: mode === "voice"
				? "语音转写中…完成后点击发送确认"
				: "输入消息与患者对话...";

	// ── Web Speech MVP（语音输入 → 转写 → 确认 → send）──
	const startVoice = useCallback(() => {
		const SR =
			(window as unknown as { SpeechRecognition?: new () => { start: () => void } }).SpeechRecognition ??
			(window as unknown as { webkitSpeechRecognition?: new () => { start: () => void } }).webkitSpeechRecognition;
		if (!SR) {
			toast.warning(VOICE_UNSUPPORTED_HINT);
			return;
		}
		const rec = new SR() as unknown as {
			lang: string;
			interimResults: boolean;
			continuous: boolean;
			start: () => void;
			stop: () => void;
			onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
			onend: (() => void) | null;
			onerror: (() => void) | null;
		};
		rec.lang = "zh-CN";
		rec.interimResults = true;
		rec.continuous = false;
		rec.onresult = (e) => {
			const parts: string[] = [];
			for (let i = 0; i < e.results.length; i += 1) {
				parts.push(e.results[i][0].transcript);
			}
			setText(parts.join(""));
		};
		rec.onend = () => setListening(false);
		rec.onerror = () => {
			setListening(false);
			toast.warning("语音识别失败，请重试或改用文字输入");
		};
		recognitionRef.current = rec;
		setMode("voice");
		setListening(true);
		try {
			rec.start();
		} catch {
			setListening(false);
			toast.warning(VOICE_UNSUPPORTED_HINT);
		}
	}, [toast]);

	const stopVoice = useCallback(() => {
		try {
			recognitionRef.current?.stop();
		} catch {
			/* ignore */
		}
		setListening(false);
	}, []);

	useEffect(() => () => stopVoice(), [stopVoice]);

	const handleSend = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || disabled || loading) return;
		// 唯一语义出口：文本 / 语音转写 / 未来通话转写都走这里
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
				style={{ maxWidth: 720, margin: "0 auto" }}
			>
				<Tooltip label={listening ? "结束语音输入" : "语音输入（Web Speech）"}>
					<ActionIcon
						variant={listening ? "filled" : "default"}
						color={listening ? "red" : undefined}
						size="lg"
						disabled={disabled || loading || trainingEnded}
						onClick={listening ? stopVoice : startVoice}
						aria-label="语音输入"
					>
						<IconBroadcast size={18} />
					</ActionIcon>
				</Tooltip>
				<Box flex={1} miw={0}>
					<textarea
						ref={inputRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
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
				<Tooltip label="通话模式（规划中，ASR 预留）">
					<ActionIcon
						variant="default"
						size="lg"
						disabled
						onClick={() => setMode("call")}
						aria-label="通话模式（规划中）"
					>
						<IconPhone size={18} />
					</ActionIcon>
				</Tooltip>
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
			{showCount && (
				<Text ta="right" size="xs" c="dimmed" pr="md">
					{text.length}/2000
				</Text>
			)}
		</Box>
	);
}
