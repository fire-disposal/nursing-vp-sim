import { lazy } from "react";

/**
 * 工作区注册表：**键 = manifest 的 `workflow.id`**。
 *
 * 服务端下发哪个 workflow，就渲染哪个工作区；缺某个 workflow 时由页面给出
 * 明确提示（「该训练工作区尚未在此版本提供」），不静默回退到别的工作区。
 */
export const TRAINING_SCENES: Record<
	string,
	React.ComponentType<{ recordId: string }>
> = {
	history_taking: lazy(() => import("./HistoryTakingScene")),
};
