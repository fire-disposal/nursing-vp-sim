import type { ComponentType } from "react";
import type { ManifestActivity } from "@/engine/manifest";
import type { SessionRecordDetail } from "@/engine/training-record-types";
import type { MessageBus } from "@/engine/types";

/**
 * Activity Renderer 契约（docs/15 §十三）。
 *
 * 面板拿到的是**服务端 manifest 里的 activity 定义**：命令命名空间、标签、
 * 产物 kinds 都来自它。面板不读病例数据、不判断自己是否可用（可用性已由
 * 工作区按 `availability` 过滤，面板被渲染即代表服务端说它可用）。
 */
export interface ActivityPanelProps {
	activity: ManifestActivity;
	bus: MessageBus;
	recordId: string;
	recordDetail: SessionRecordDetail | null;
}

export type ActivityRenderer = ComponentType<ActivityPanelProps>;

/**
 * 内置工作区面板（非 Activity）：问诊清单只是 `record.required_inquiries`
 * 的本地视图，没有病例配置、没有产物、不参与完成判定，因此不进 manifest。
 */
export interface WorkspacePanelProps {
	bus: MessageBus;
	recordId: string;
	recordDetail: SessionRecordDetail | null;
}
