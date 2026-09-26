import { Badge } from "@mantine/core";
import type { ManifestActivity, ManifestArtifact } from "@/engine/manifest";
import { ARTIFACT_DRAFT, ARTIFACT_EMPTY, ARTIFACT_SUBMITTED } from "@/engine/manifest";

/** 服务端 `availability.reason_code` → 学生可读原因（服务端只给码，不给文案） */
const REASON_LABELS: Record<string, string> = {
	case_not_configured: "本病例未配置",
	disabled_by_override: "本次训练已关闭",
	workflow_not_allowed: "该工作区不支持",
	session_not_active: "训练已结束",
};

export interface ActivityStatus {
	label: string;
	color: string;
}

/**
 * 把一个 Activity 的服务端状态翻成一句话（`null` = 无需提示）。
 *
 * 只读服务端下发的 `availability` / `artifacts[].state`，不做任何判定：
 * 侧栏红点、移动端标签、面板徽章共用同一份语义（三处必须一致）。
 */
export function activityStatus(
	activity: ManifestActivity,
	artifact?: ManifestArtifact,
): ActivityStatus | null {
	if (activity.availability.state !== "available") {
		const reason = activity.availability.reason_code;
		return { label: reason ? REASON_LABELS[reason] ?? "不可用" : "不可用", color: "gray" };
	}
	if (!artifact) return null;
	if (artifact.state === ARTIFACT_DRAFT) return { label: "草稿未提交", color: "orange" };
	if (artifact.state === ARTIFACT_SUBMITTED) return { label: "已提交", color: "green" };
	// 空产物：仅当 workflow 要求它时提示「未填写」，否则不打扰
	if (artifact.state === ARTIFACT_EMPTY && artifact.required) return { label: "未填写", color: "orange" };
	return null;
}

export interface ActivityStatusBadgeProps {
	activity: ManifestActivity;
	/** 该 activity 的产物状态（`manifest.artifacts[activity.artifact_kind]`），无产物则省略 */
	artifact?: ManifestArtifact;
}

export function ActivityStatusBadge({ activity, artifact }: ActivityStatusBadgeProps) {
	const status = activityStatus(activity, artifact);
	if (!status) return null;
	return (
		<Badge variant="light" color={status.color} size="xs">
			{status.label}
		</Badge>
	);
}
