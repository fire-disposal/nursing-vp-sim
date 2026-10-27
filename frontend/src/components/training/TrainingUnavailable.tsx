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
		<Center style={{ minHeight: "100dvh" }}>
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
