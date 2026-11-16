import { Button, Center, Group, Stack, Text } from "@mantine/core";
import { useLocation, useNavigate } from "react-router-dom";
import { readTrainingOrigin, trainingOriginLabel } from "@/utils/training-nav";

/**
 * 训练页（沉浸壳 `/training/:recordId`）的失败态。
 *
 * 这条路由没有 App 导航（`activity: "practice"`），页面自己的顶栏是唯一出口；凡是在
 * 顶栏渲染之前就中断的状态（记录加载失败 / 记录不存在 / 工作区缺失 / 工作区崩溃）
 * 都必须自带出口，否则学生只能靠浏览器后退离开。
 * 2026-10-27 反馈「没法结束训练，也无法退出了」就是这一类死路：有内容、有报错，
 * 但没有任何可点的下一步。
 *
 * 落点与训练页顶栏同一口径（`readTrainingOrigin`）：有来源回来源，直链进来落记录列表。
 */
/** 训练页失败态的唯一文案来源：6 处调用都从这里取，避免同一件事四种说法。 */
export const trainingUnavailableCopy = {
	loadFailed: {
		title: "训练记录加载失败",
		detail: "记录没有取到。网络恢复后重试；也可以直接返回，已开始的记录不会丢。",
	},
	missing: {
		title: "训练记录不存在",
		detail: "这条记录可能已被删除，或你没有查看权限。",
	},
	workspaceMissing: (label: string) => ({
		title: "该训练工作区在此版本不可用",
		detail: `工作区：${label}。请重试或返回，已保存的对话不会丢。`,
	}),
	renderCrashed: {
		title: "训练页渲染出错",
		detail: "页面出错了。重试或返回；对话与证据都保存在服务器上。",
	},
	stateUnreadable: (reason: string | null | undefined) => ({
		title: "无法读取训练状态",
		detail: reason || "服务器没有返回本次训练的场景与目标，请重试。",
	}),
};

export function TrainingUnavailable({
	title,
	detail,
	onRetry,
	retrying,
}: {
	title: string;
	detail?: string | null;
	onRetry?: () => void;
	retrying?: boolean;
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const from = readTrainingOrigin(location.state);
	const leaveLabel = trainingOriginLabel(from);

	return (
		<Center className="training-immersive-min">
			<Stack align="center" gap="sm" p="xl" ta="center">
				<Text fw={500}>{title}</Text>
				{detail && (
					<Text size="xs" c="dimmed" maw={384} style={{ wordBreak: "break-word" }}>
						{detail}
					</Text>
				)}
				<Group gap={8} mt={4}>
					{onRetry && (
						<Button variant="outline" onClick={onRetry} loading={retrying}>
							重试
						</Button>
					)}
					<Button
						variant="default"
						title={leaveLabel}
						aria-label={leaveLabel}
						onClick={() => navigate(from ?? "/history")}
					>
						返回
					</Button>
				</Group>
			</Stack>
		</Center>
	);
}
