import { IconLoader2, IconMicrophone, IconSend } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { ActionIcon, Box, Group, Text } from "@mantine/core";


interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
	trainingEnded?: boolean;
}

export function ChatInput({ onSend, disabled, loading, trainingEnded }: ChatInputProps) {
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const showCount = text.length >= 1600;
	const placeholder = trainingEnded
		? "训练已结束，评分结果已生成"
		: loading
			? "患者正在回复中…"
			: "输入消息与患者对话...";


	const handleSend = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || disabled || loading) return;
		onSend(trimmed);
		setText("");
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
			style={{
				borderTop: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-gray-0)",
				flexShrink: 0,
				paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)",
			}}
		>
			<Group
				align="flex-end"
				gap={10}
				wrap="nowrap"
				mx="auto"
				w="100%"
				maw={768}
				px="xs"
				py={10}
				style={{ position: "relative" }}
			>
				<ActionIcon
					variant="filled"
					size="xl"
					radius="md"
					type="button"
					onClick={() => {}}
					aria-label="语音输入"
					title="语音输入"
				>
					<IconMicrophone size={18} />
				</ActionIcon>
				<textarea
					ref={inputRef}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={handleKeyDown}
					maxLength={2000}
					placeholder={placeholder}
					rows={1}
					onInput={handleInput}
					inputMode="text"
					enterKeyHint="send"
					autoCapitalize="off"
					autoCorrect="off"
					style={{
						flex: 1,
						resize: "none",
						borderRadius: 12,
						border: "1px solid var(--mantine-color-default-border)",
						background: "var(--mantine-color-body)",
						padding: "10px 14px",
						fontSize: 14,
						outline: "none",
						minHeight: 44,
						color: "var(--mantine-color-text)",
						fontFamily: "inherit",
					}}
					aria-label="输入消息与患者对话"
				/>
				<ActionIcon
					variant="filled"
					size="xl"
					radius="md"
					type="button"
					onClick={handleSend}
					disabled={disabled || loading || !text.trim()}
					aria-label={loading ? "患者正在回复，暂不能发送" : "发送消息"}
					title={loading ? "患者正在回复，暂不能发送" : "发送消息"}
				>
					{loading ? (
						<IconLoader2 size={18} className="animate-spin" />
					) : (
						<IconSend size={18} />
					)}
				</ActionIcon>
				{showCount && (
					<Text
						size="xs"
						c="dimmed"
						style={{
							position: "absolute",
							bottom: 0,
							right: 64,
							transform: "translateY(100%)",
							paddingTop: 4,
							fontVariantNumeric: "tabular-nums",
						}}
					>
						{text.length}/2000
					</Text>
				)}
			</Group>
		</Box>
	);
}
