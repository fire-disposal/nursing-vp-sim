import { IconCheck, IconInfoCircle, IconPencil, IconX } from "@tabler/icons-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/engine/types";
import { ActionIcon, Avatar, Badge, Box, Button, Group, Loader, Stack, Text, Typography } from "@mantine/core";
import { Textarea } from "@mantine/core";

interface ChatBubbleProps {
	message: ChatMessage;
	patientAvatar: string;
	nurseAvatar: string;
	emotionBorder: string;
	portraitUrl: string | null;
	initiative?: boolean;
	showAvatar?: boolean;
	canCorrect?: boolean;
	correctionsRemaining?: number;
	onCorrect?: (content: string) => void;
	/** 失败重试：原样重发这句话（装配层负责先移除失败气泡，避免同一句出现两条）。 */
	onRetry?: () => void;
}

function areBubblePropsEqual(
	oldProps: ChatBubbleProps,
	newProps: ChatBubbleProps,
) {
	return (
		oldProps.message.id === newProps.message.id &&
		oldProps.message.content === newProps.message.content &&
		oldProps.message.streaming === newProps.message.streaming &&
		oldProps.message.role === newProps.message.role &&
		oldProps.message.streamError === newProps.message.streamError &&
		oldProps.emotionBorder === newProps.emotionBorder &&
		oldProps.portraitUrl === newProps.portraitUrl &&
		oldProps.initiative === newProps.initiative &&
		oldProps.showAvatar === newProps.showAvatar &&
		oldProps.canCorrect === newProps.canCorrect &&
		oldProps.correctionsRemaining === newProps.correctionsRemaining &&
		oldProps.onRetry === newProps.onRetry
	);
}

export const ChatBubble = memo(function ChatBubble({
	message,
	patientAvatar,
	nurseAvatar,
	emotionBorder,
	portraitUrl,
	initiative,
	showAvatar,
	canCorrect,
	correctionsRemaining = 0,
	onCorrect,
	onRetry,
}: ChatBubbleProps) {
	const displayAvatar = portraitUrl || patientAvatar;
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.content);
	const trimmedDraft = draft.trim();
	const canSubmitCorrection = trimmedDraft.length > 0 && trimmedDraft !== message.content.trim();

	if (message.role === "system") {
		return (
			<Group justify="center" data-role="system">
				<Group
					align="flex-start"
					gap={8}
					maw="85%"
					px="sm"
					py={8}
					style={{
						borderRadius: 999,
						background: "var(--mantine-color-brand-light)",
						color: "var(--mantine-color-brand-light-color)",
					}}
				>
					<IconInfoCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
					<Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
						{message.content}
					</Text>
				</Group>
			</Group>
		);
	}

	if (message.role === "patient") {
		const isStreamingEmpty = message.streaming && !message.content;

		return (
			<Group align="flex-start" gap={8} justify="flex-start" wrap="nowrap" data-role="patient">
				{showAvatar !== false ? (
					<Avatar src={displayAvatar} alt="患者" radius="xl" size={32} style={{ flexShrink: 0 }} />
				) : (
					<Box w={32} h={32} style={{ flexShrink: 0 }} />
				)}
				<Box
					data-streaming={message.streaming || undefined}
					style={{
						maxWidth: "88%",
						padding: "10px 14px",
						borderRadius: 16,
						borderTopLeftRadius: 4,
						borderStyle: "solid",
						borderWidth: 2,
						borderColor: emotionBorder,
						lineHeight: 1.6,
						wordBreak: "break-word",
						fontSize: 14,
						background: "var(--mantine-color-body)",
						color: "var(--mantine-color-text)",
						boxShadow: "var(--mantine-shadow-xs)",
						transition: "border-color 200ms ease, box-shadow 200ms ease",
					}}
				>
					{initiative && (
						<Badge variant="light" color="yellow" size="xs" mb={4}>
							患者自主反应
						</Badge>
					)}
					{isStreamingEmpty ? (
						<Group gap={8} py={4}>
							<Text size="sm" c="dimmed">患者正在回复</Text>
							<Loader size="sm" type="dots" color="gray" />
						</Group>
					) : message.streaming ? (
						<Text style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6 }}>
							{message.content}
							<span className="stream-cursor" aria-hidden="true" />
						</Text>
					) : (
						<Typography>
							<ReactMarkdown remarkPlugins={[remarkGfm]}>
								{message.content}
							</ReactMarkdown>
						</Typography>
					)}
					{!isStreamingEmpty && message.streamError && (
						<Group gap={8} mt={6} wrap="nowrap" align="center">
							<Text
								size="xs"
								c="var(--mantine-color-yellow-light-color)"
								style={{
									background: "var(--mantine-color-yellow-light)",
									borderRadius: 4,
									padding: "2px 6px",
								}}
								title={message.streamError}
							>
								⚠ 回复中断：网络或服务繁忙
							</Text>
							{onRetry && (
								<Button variant="light" color="yellow" size="compact-xs" onClick={onRetry}>
									重试
								</Button>
							)}
						</Group>
					)}
				</Box>
			</Group>
		);
	}

	if (editing) {
		return (
			<Group align="flex-start" gap={8} justify="flex-end" wrap="nowrap" data-role="student">
				<Box
					w="100%"
					maw="88%"
					p={10}
					style={{
						borderRadius: 16,
						borderTopRightRadius: 4,
						background: "var(--mantine-primary-color-light)",
						border: "1px solid var(--mantine-primary-color-light-color)",
					}}
				>
					<Textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						maxLength={2000}
						autoFocus
						autosize
						minRows={2}
						maxRows={6}
					/>
					<Group justify="space-between" gap={8} mt={8} wrap="nowrap">
						<Text size="xs" c="dimmed">
							将重新生成患者回复，剩余 {correctionsRemaining} 次
						</Text>
						<Group gap={6}>
							<ActionIcon
								variant="subtle"
								color="gray"
								radius="md"
								onClick={() => {
									setDraft(message.content);
									setEditing(false);
								}}
								aria-label="取消修正"
							>
								<IconX size={16} />
							</ActionIcon>
							<ActionIcon
								variant="filled"
								radius="md"
								disabled={!canSubmitCorrection}
								onClick={() => {
									if (!canSubmitCorrection) return;
									onCorrect?.(trimmedDraft);
									setEditing(false);
								}}
								aria-label="提交修正"
							>
								<IconCheck size={16} />
							</ActionIcon>
						</Group>
					</Group>
				</Box>
				<Avatar src={nurseAvatar} alt="护士" radius="xl" size={32} style={{ flexShrink: 0 }} />
			</Group>
		);
	}

	return (
		<Group align="flex-start" gap={8} justify="flex-end" wrap="nowrap" data-role="student">
			<Stack align="flex-end" gap={4} w="100%">
				<Box
					style={{
						maxWidth: "88%",
						padding: "10px 14px",
						borderRadius: 16,
						borderTopRightRadius: 4,
						fontSize: 14,
						lineHeight: 1.6,
						wordBreak: "break-word",
						// 学生面基调由 .stu-surface 的变量决定；这里只声明"取哪个变量"，
						// 不用 !important 去抢内联样式（那是拼凑感的来源之一）。
						background: "var(--stu-bubble-own, var(--mantine-primary-color-filled))",
						color: "var(--stu-bubble-own-ink, var(--mantine-primary-color-contrast))",
						border: "1px solid var(--stu-bubble-own-line, transparent)",
						// 未送达：压暗但保留，学生能看出"这句我说过、只是没送到"
						opacity: message.streamError ? 0.55 : 1,
					}}
				>
					<Text style={{ whiteSpace: "pre-wrap" }}>{message.content}</Text>
				</Box>
				{message.streamError && (
					<Group gap={8} align="center" wrap="nowrap">
						<Text size="xs" c="var(--mantine-color-red-light-color)" title={message.streamError}>
							✕ 未送达：网络或服务繁忙
						</Text>
						{onRetry && (
							<Button variant="light" color="gray" size="compact-xs" onClick={onRetry}>
								重新发送
							</Button>
						)}
					</Group>
				)}
				{canCorrect && (
					<Box
						component="button"
						type="button"
						onClick={() => {
							setDraft(message.content);
							setEditing(true);
						}}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							borderRadius: 999,
							padding: "2px 8px",
							fontSize: 12,
							color: "var(--mantine-color-dimmed)",
							background: "transparent",
							border: "none",
							cursor: "pointer",
						}}
					>
						<IconPencil size={12} />
						修正 · 剩余 {correctionsRemaining}
					</Box>
				)}
			</Stack>
			<Avatar src={nurseAvatar} alt="护士" radius="xl" size={32} style={{ flexShrink: 0 }} />
		</Group>
	);
}, areBubblePropsEqual);
