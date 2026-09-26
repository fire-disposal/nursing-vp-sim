import { useEffect, useMemo } from "react";
import { type ManifestActivity, type ManifestArtifact, availableActivities } from "@/engine/manifest";
import { useTrainingStore } from "@/stores/trainingStore";
import { INQUIRY_PANEL_ID, QUIZ_PANEL_ID, useWorkspaceStore } from "@/stores/workspaceStore";
import { WIDE_ACTIVITY_RENDERERS } from "./renderers";

/**
 * 工作区面板清单 —— manifest 驱动的唯一来源。
 *
 * 面板集合 = `manifest.activities` 中 `availability.state === "available"` 的项
 * （顺序即服务端 `ui.order`）+ 可能的内置问诊清单视图。
 * 前端**不**过滤、不排序、不推断可用性。
 */
export interface WorkspacePane {
	id: string;
	label: string;
	/** 布局宽度分组（服务端未下发宽度，纯视觉） */
	wide: boolean;
	/** 该面板对应的 activity 定义；`null` = 内置面板（问诊清单） */
	activity: ManifestActivity | null;
}

export function useWorkspacePanes(): WorkspacePane[] {
	const manifest = useTrainingStore((state) => state.manifest);
	const recordDetail = useTrainingStore((state) => state.recordDetail);
	const mode = recordDetail?.mode ?? "guided";
	const inquiryCount = recordDetail?.required_inquiries?.length ?? 0;

	return useMemo(() => {
		const panes: WorkspacePane[] = availableActivities(manifest).map((activity) => ({
			id: activity.id,
			label: activity.label,
			wide: WIDE_ACTIVITY_RENDERERS[activity.ui.renderer] === true,
			activity,
		}));
		// 问诊清单：仅引导模式、且病例给过清单时提供（与「对话为主界面」的信息层级一致）
		if (mode === "guided" && inquiryCount > 0) {
			panes.push({ id: INQUIRY_PANEL_ID, label: "问诊清单", wide: false, activity: null });
		}
		return panes;
	}, [manifest, mode, inquiryCount]);
}

/**
 * 首次进入若病例挂载了随堂测验，默认展开测验面板（保持原有到达性）。
 *
 * 只生效一次：学生手动收起后不再重开（状态在 workspaceStore 里，两个断点的
 * 工作区实例共用同一个标记）。
 */
export function useInitialActivityPanel() {
	const panes = useWorkspacePanes();
	const applyInitialPanel = useWorkspaceStore((state) => state.applyInitialPanel);
	const hasQuiz = panes.some((pane) => pane.id === QUIZ_PANEL_ID);
	useEffect(() => {
		if (hasQuiz) applyInitialPanel(QUIZ_PANEL_ID);
	}, [hasQuiz, applyInitialPanel]);
}

/** 该 activity 的产物状态（`manifest.artifacts[artifact_kind]`）；无产物/未下发 → undefined。 */
export function useActivityArtifact(activity: ManifestActivity | null): ManifestArtifact | undefined {
	const manifest = useTrainingStore((state) => state.manifest);
	if (!activity?.artifact_kind) return undefined;
	return manifest?.artifacts[activity.artifact_kind];
}
