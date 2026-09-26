/**
 * Activity id → 展示元数据（图标 + 兜底中文名）。
 *
 * manifest 已下发权威 label，学生训练页一律用它；这里的标签只服务于
 * **拿不到 manifest 的展示场景**（教师侧病例列表的能力徽章只有布尔表）。
 * 纯呈现：不参与可用性/完成判定。authoring projection 落地后应改读服务端。
 */
import {
	IconClipboardList,
	IconFileText,
	IconHeartbeat,
	IconHelpCircle,
	IconListCheck,
	IconStethoscope,
	type TablerIcon,
} from "@tabler/icons-react";

export const ACTIVITY_LABELS: Record<string, string> = {
	physical_exam: "床旁检查",
	nursing_record: "护理记录",
	quiz: "随堂测验",
	nursing_diagnosis: "护理诊断",
};

export const ACTIVITY_ICONS: Record<string, TablerIcon> = {
	physical_exam: IconHeartbeat,
	nursing_record: IconFileText,
	quiz: IconHelpCircle,
	nursing_diagnosis: IconStethoscope,
	inquiry: IconListCheck,
};

export const DEFAULT_ACTIVITY_ICON: TablerIcon = IconClipboardList;
