import { Box, Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconAlertTriangle, IconArrowUp, IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { type ClinicalSendError, SAFETY_BLOCKED_CODE } from "./useClinicalReasoning";

/**
 * 输入带：床旁操作的主入口（对话是本工作区的主操作，不是中间一块等宽空白）。
 *
 * 非流式语义体现在文案而不是假打字动画：发送中 → 输入禁用 + 明确的"患者正在回应"，
 * 回执到达后气泡才出现（气泡本身在 `PatientStage` 的实录里）。
 *
 * 失败分三种（前两种与状态机的 `retryMode` 一一对应），文案必须说清接下来会发生什么：
 * - 结果未知（网络）：沿用同一轮，若服务器已保存会直接取回那次回复；
 * - 服务端明确失败：这一轮已落库为失败回合，重试是新的一轮；
 * - 安全拦截（`chat.safety_blocked`）：患者这句没有入库，原样重发只会再被拦一次 ——
 *   主操作是把**原话填回草稿**让学生改写，不提供"重试"。
 */
export function Composer({
	sending,
	sendError,
	locked,
	onSend,
	onRetrySend,
}: {
	sending: boolean;
	sendError: ClinicalSendError | null;
	/** 交卷中：锁死输入（页面即将跳转）。 */
	locked: boolean;
	onSend: (content: string) => void;
	onRetrySend: () => void;
}) {
	const [draft, setDraft] = useState("");
	const canSend = draft.trim().length > 0 && !sending && !locked;

	const safetyBlocked = sendError?.code === SAFETY_BLOCKED_CODE;

	const submit = () => {
		if (!canSend) return;
		const text = draft;
		setDraft("");
		onSend(text);
	};

	/** 红线拦截后唯一正确的下一步：把失败的原话放回输入框，由学生自己改写。 */
	const editOriginal = () => {
		if (!sendError) return;
		setDraft(sendError.content);
	};

	return (
		<Box
			className="cr-compose"
			style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
		>
			{sendError && (
				<Box className="cr-notice" data-tone="danger" role="alert">
					<IconAlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
					<Stack gap={4} style={{ minWidth: 0 }}>
						<Text size="xs" fw={600} style={{ wordBreak: "break-word" }}>
							{sendError.message}
						</Text>
						<Text size="xs" c="var(--ns-ink-dim)" lh={1.5}>
							{safetyBlocked
								? "这句话已保留。原样重发会再次被拦下，请改一改再发。"
								: sendError.retryMode === "unknown"
									? "网络中断时结果不确定：重试沿用同一轮，若服务器已保存会直接取回那次回复。"
									: "这句话已保存，但患者的回复生成失败。重试会作为新的一轮重新生成。"}
						</Text>
						{safetyBlocked ? (
							<Button
								size="compact-xs"
								variant="light"
								color="orange"
								leftSection={<IconPencil size={13} />}
								onClick={editOriginal}
								disabled={locked}
								style={{ alignSelf: "flex-start" }}
							>
								填入原话并修改
							</Button>
						) : (
							<Button
								size="compact-xs"
								variant="light"
								color="orange"
								onClick={onRetrySend}
								disabled={sending || locked}
								style={{ alignSelf: "flex-start" }}
							>
								重试发送
							</Button>
						)}
					</Stack>
				</Box>
			)}
			<Group gap={8} p="sm" align="flex-end" wrap="nowrap">
				<Textarea
					value={draft}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
							event.preventDefault();
							submit();
						}
					}}
					placeholder={
						sending ? "患者正在回应…" : "对患者说…（Enter 发送，Shift+Enter 换行）"
					}
					aria-label="对患者说的话"
					autosize
					minRows={1}
					maxRows={4}
					disabled={sending || locked}
					styles={{ input: { borderColor: "var(--ns-line)" } }}
					style={{ flex: 1 }}
				/>
				<Button
					onClick={submit}
					disabled={!canSend}
					loading={sending}
					aria-label="发送"
					variant="filled"
					color="teal"
					leftSection={sending ? undefined : <IconArrowUp size={15} />}
				>
					发送
				</Button>
			</Group>
		</Box>
	);
}
