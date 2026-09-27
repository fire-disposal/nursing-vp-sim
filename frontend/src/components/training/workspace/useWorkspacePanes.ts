import { useEffect, useMemo } from "react";
import { type ManifestActivity, type ManifestArtifact, availableActivities } from "@/engine/manifest";
import { useRecordMeta, useSessionManifest, useTrainingData } from "@/engine/TrainingDataContext";
import { INQUIRY_PANEL_ID, QUIZ_PANEL_ID, useWorkspaceStore } from "@/stores/workspaceStore";
import { parseGuidedHints } from "@/components/training/tools/inquiryProgress";
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
	/** 该面板对应的 activity 定义；`null` = 内置面板（问诊清单/引导提示） */
	activity: ManifestActivity | null;
}

export function useWorkspacePanes(): WorkspacePane[] {
	const manifest = useSessionManifest();
	const record = useTrainingData();
	const { mode, requiredInquiries } = useRecordMeta();
	const inquiryCount = requiredInquiries.length;
	const hintCount = useMemo(() => parseGuidedHints(record?.guided_hints).length, [record]);

	return useMemo(() => {
		const panes: WorkspacePane[] = availableActivities(manifest).map((activity) => ({
			id: activity.id,
			label: activity.label,
			wide: WIDE_ACTIVITY_RENDERERS[activity.ui.renderer] === true,
			activity,
		}));
		// 引导视图：蓝图给了「领域 + 意义」就按引导提示命名（docs/19 §3.3），
		// 否则沿用关键词清单。两种形态都只服务引导模式，盲盒/独立考核不出现。
		if (mode === "guided" && (hintCount > 0 || inquiryCount > 0)) {
			panes.push({
				id: INQUIRY_PANEL_ID,
				label: hintCount > 0 ? "引导提示" : "问诊清单",
				wide: false,
				activity: null,
			});
		}
		return panes;
	}, [manifest, mode, inquiryCount, hintCount]);
}

/**
 * 工作区按钮要显示的入口（侧栏 / 竖屏能力条）。
 *
 * 问诊清单/引导提示的入口在**患者卡的进度 chip**（`InquiryProgressChip`）上，工作区再放一个同名
 * 入口只是把同一件事说两遍；面板本身仍从 `useWorkspacePanes()` 解析，因此 chip 照常能打开它。
 */
export function useDockPanes(): WorkspacePane[] {
	return useWorkspacePanes().filter((pane) => pane.id !== INQUIRY_PANEL_ID);
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
	const manifest = useSessionManifest();
	if (!activity?.artifact_kind) return undefined;
	return manifest?.artifacts[activity.artifact_kind];
}
