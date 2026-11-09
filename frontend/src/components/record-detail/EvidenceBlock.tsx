import { Badge, Box, Group, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconMessageCircle } from "@tabler/icons-react";

interface Props {
	evidence?: string;
	reason?: string;
	/** 服务端是否在既有记录中定位到该证据；false = 不提供跳转，如实标注「未能定位证据」 */
	evidenceVerified?: boolean;
	/** 服务端解析出的消息类证据引用 id（kind=message） */
	messageIds?: (number | string)[];
	onMessageClick?: (messageId: number | string) => void;
}

/**
 * 证据块（逐项判定与关键选择共用）。
 *
 * 定位口径完全由服务端 `evidence_verified` + `evidence_refs` 决定：
 * 只有服务端**定位成功**且引用的是具体消息时，才给出「跳到对话」的入口；
 * 未定位成功时如实标注「未能定位证据」，不再用前端子串猜位置。
 */
export default function EvidenceBlock({
	evidence,
	reason,
	evidenceVerified,
	messageIds,
	onMessageClick,
}: Props) {
	const canJump =
		evidenceVerified !== false && !!messageIds?.length && !!onMessageClick && !!evidence;

	if (!evidence && !reason) return null;

	return (
		<Box
			p="sm"
			style={{
				background: "var(--mantine-color-default-hover)",
				border: "1px solid var(--mantine-color-default-border)",
				borderRadius: "var(--mantine-radius-md)",
			}}
		>
			{evidence && (
				<Box mb={reason ? "xs" : undefined}>
					<Group gap={6} mb={2} wrap="nowrap">
						<IconMessageCircle size={11} />
						<Text size="sm" fw={600} c="dimmed">
							证据
						</Text>
						{evidenceVerified === false && (
							<Badge variant="light" color="gray" size="xs">
								<IconAlertTriangle size={10} /> 未能定位证据
							</Badge>
						)}
					</Group>
					{canJump ? (
						<UnstyledButton
							onClick={() => onMessageClick!(messageIds![0])}
							style={{ textAlign: "left", width: "100%" }}
							aria-label="在对话回放中定位该证据"
						>
							<Text size="sm" opacity={0.8} td="underline" c="brand">
								{evidence}
							</Text>
						</UnstyledButton>
					) : (
						<Text size="sm" opacity={evidenceVerified === false ? 0.6 : 0.8}>
							{evidence}
						</Text>
					)}
				</Box>
			)}
			{reason && (
				<Box>
					<Text size="sm" fw={600} c="dimmed">
						理由：
					</Text>
					<Text size="sm" opacity={0.8}>
						{reason}
					</Text>
				</Box>
			)}
		</Box>
	);
}
