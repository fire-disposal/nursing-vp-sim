import type { ComponentType } from "react";
import type { ManifestActivity } from "@/engine/manifest";
import type { MessageBus } from "@/engine/types";

/**
 * Activity Renderer 契约（docs/15 §十三）。
 *
 * 面板拿到的是**服务端 manifest 里的 activity 定义**：命令命名空间、标签、
 * 产物 kinds 都来自它。面板不读病例数据、不判断自己是否可用（可用性已由
 * 工作区按 `availability` 过滤，面板被渲染即代表服务端说它可用）；
 * 面板自身需要的病例字段走 `TrainingDataContext` 的派生 hook，不透传 record。
 */
export interface ActivityPanelProps {
	activity: ManifestActivity;
	bus: MessageBus;
	recordId: string;
}

export type ActivityRenderer = ComponentType<ActivityPanelProps>;
