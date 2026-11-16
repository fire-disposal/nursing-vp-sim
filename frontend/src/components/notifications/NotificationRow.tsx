import { ActionIcon, Box, Group, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import {
	IconAlertTriangle,
	IconBell,
	IconCircleCheck,
	IconClipboardList,
	IconEye,
	IconEyeOff,
	IconMessageReply,
	IconSpeakerphone,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { components } from "@/api/api-types.gen";
import { formatShortDateTime } from "@/utils/date";

export type NotificationItem = components["schemas"]["TrainingNotificationItem"];

/**
 * 通知行的唯一实现 —— 铃铛弹层、通知中心、训练首页卡片共用。
 *
 * 之前三处各写一套：弹层里时间是 `created_at.slice(0,16)`（UTC 串直接当本地时间显示）、
 * 收件箱里是 11px 小字 + 蓝色左边条、首页卡片只有标题没有类型与时间。同一批数据三种长相，
 * 用户得在三套视觉里重新学一遍"这是什么时候、什么类型、读没读"。
 *
 * 约定：类型决定图标与色调，未读用「左侧品牌色窄条 + 轻微底色 + 标题加粗」表达，
 * 读/未读切换是行的兄弟按钮（不能嵌在行的按钮里）。
 */
const META: Record<string, { label: string; icon: ReactNode; tone: string }> = {
	assignment_new: { label: "新作业", icon: <IconClipboardList size={16} />, tone: "brand" },
	scoring_complete: { label: "评分完成", icon: <IconCircleCheck size={16} />, tone: "green" },
	scoring_failed: { label: "评分失败", icon: <IconAlertTriangle size={16} />, tone: "red" },
	feedback_replied: { label: "反馈回复", icon: <IconMessageReply size={16} />, tone: "yellow" },
	system: { label: "系统通知", icon: <IconSpeakerphone size={16} />, tone: "gray" },
};

export function notificationMeta(type: string) {
	if (META[type]) return META[type];
	// assignment_removed / assignment_due 等由后端扩展的类型：归到"作业"一族
	if (type.startsWith("assignment_")) return META.assignment_new;
	if (type.startsWith("scoring_")) return META.scoring_complete;
	return { label: type || "通知", icon: <IconBell size={16} />, tone: "gray" };
}

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
	assignment_new: "新作业",
	scoring_complete: "评分完成",
	scoring_failed: "评分失败",
	feedback_replied: "反馈回复",
	system: "系统通知",
};

export function NotificationRow({
	item,
	onOpen,
	onToggleRead,
	compact = false,
}: {
	item: NotificationItem;
	onOpen: () => void;
	onToggleRead: () => void;
	/** 弹层/首页卡片用紧凑行：正文只留一行 */
	compact?: boolean;
}) {
	const meta = notificationMeta(item.type);
	const unread = !item.is_read;

	return (
		<Box
			data-unread={unread || undefined}
			style={{
				position: "relative",
				// 未读的语义标记留在容器上：按钮只承担点击区域，焦点环不会盖住这条窄条
				borderLeft: unread ? "2px solid var(--mantine-color-brand-7)" : "2px solid transparent",
				background: unread
					? "color-mix(in srgb, var(--mantine-color-brand-7) 5%, transparent)"
					: undefined,
			}}
		>
			<UnstyledButton
				onClick={onOpen}
				aria-label={`${meta.label}：${item.title}${unread ? "（未读）" : ""}`}
				style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 44px 10px 12px" }}
			>
				<Group gap={10} align="flex-start" wrap="nowrap">
					<ThemeIcon variant="light" color={meta.tone} size={30} radius="md" style={{ flexShrink: 0, marginTop: 1 }}>
						{meta.icon}
					</ThemeIcon>
					<Box style={{ minWidth: 0, flex: 1 }}>
						<Text
							size="sm"
							fw={unread ? 600 : 500}
							lh={1.4}
							c={item.is_read ? "dimmed" : undefined}
							style={{ overflowWrap: "anywhere" }}
						>
							{item.title}
						</Text>
						{item.body && (
							<Text size="sm" c="dimmed" mt={2} lh={1.5} lineClamp={compact ? 1 : 2}>
								{item.body}
							</Text>
						)}
						<Group gap={8} mt={4} wrap="nowrap">
							<Text size="sm" c={meta.tone === "gray" ? "dimmed" : `${meta.tone}.7`} fw={500}>
								{meta.label}
							</Text>
							<Text size="sm" c="dimmed">
								{formatShortDateTime(item.created_at)}
							</Text>
						</Group>
					</Box>
				</Group>
			</UnstyledButton>
			{/* 读/未读切换：行的兄弟按钮（按钮不能嵌按钮，否则内层点击会连带触发导航） */}
			<ActionIcon
				variant="subtle"
				color="gray"
				size={28}
				onClick={onToggleRead}
				aria-label={unread ? "标记为已读" : "标记为未读"}
				title={unread ? "标记为已读" : "标记为未读"}
				style={{ position: "absolute", top: 50, transform: "translateY(-50%)", right: 6 }}
			>
				{unread ? <IconEye size={15} /> : <IconEyeOff size={15} />}
			</ActionIcon>
		</Box>
	);
}
