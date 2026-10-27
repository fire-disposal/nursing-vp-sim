import { Button } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { getApiErrorMessage } from "@/utils/error";
import EmptyState from "./empty-state";

interface ErrorStateProps {
	/** 标题；默认「加载失败」 */
	title?: string;
	/** 原始错误对象：有就按状态码/服务端文案翻成人话，绝不原样上屏 */
	error?: unknown;
	/** 覆盖错误详情（例如重试也无意义时给一句解释） */
	description?: string;
	/** 有重试就渲染按钮 —— 只写「请稍后重试」而不给入口，等于让用户整页刷新丢筛选 */
	onRetry?: () => void;
}

/**
 * ErrorState — 失败态的唯一呈现。
 *
 * 存在的理由：各列表页此前把「请求失败」渲染成「暂无数据」，用户会以为业务上真的没有，
 * 于是重复注册/重复建作业；而少数写了失败文案的页面又只有文字、没有重试入口。
 * 这里把三件事绑在一起：人话错误 + 明确「失败」标题 + 重试按钮。
 */
export default function ErrorState({ title, error, description, onRetry }: ErrorStateProps) {
	const detail = description ?? getApiErrorMessage(error, "请求没有成功，服务端可能暂时不可用");
	return (
		<EmptyState
			icon={IconAlertTriangle}
			title={title ?? "加载失败"}
			description={detail}
			action={
				onRetry ? (
					<Button
						variant="light"
						size="xs"
						leftSection={<IconRefresh size={14} />}
						onClick={onRetry}
					>
						重试
					</Button>
				) : undefined
			}
		/>
	);
}
