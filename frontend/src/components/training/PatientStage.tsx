import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrainingStore } from "@/stores/trainingStore";
import { getPatientAvatar } from "@/utils/avatar";
import { EmotionIndicator } from "./EmotionIndicator";
import { InquiryProgressChip } from "./InquiryProgressChip";

/**
 * PatientStage — 患者区（训练三区布局的一级区域，观察对象）。
 *
 * 布局反思：对话不再独占页面——患者区与对话区并列。
 * 区内聚合了此前分散的三处患者呈现：
 *   患者立绘 → 静态头像（论文病例写实 PNG，其余简洁头像；不再用情绪换脸 SVG）
 *   情绪栏   → EmotionIndicator（标签 + 4D 条 + 主动追问轮询）
 *   患者信息 → 信息块（姓名/年龄/性别/主诉）
 * 桌面：固定 280px 左栏；移动端：顶部区，可折叠成紧凑条。
 * 情绪变化通过 EmotionIndicator 的标签/指标表达，不更换人物。
 */

export default function PatientStage() {
	const [mobileOpen, setMobileOpen] = useState(true);
	const bus = useTrainingStore((s) => s.bus)!;
	const capabilities = useTrainingStore((s) => s.capabilities);
	const recordId = Number(useTrainingStore((s) => s.recordId));
	const patient = useTrainingStore((s) => s.patient);

	const avatarSrc = getPatientAvatar(patient);

	const name = patient?.name ?? "患者";
	const age = typeof patient?.age === "number" && patient.age > 0 ? patient.age : null;
	const gender = patient?.gender === "male" ? "男" : patient?.gender === "female" ? "女" : "";
	const chiefComplaint = patient?.chiefComplaint ?? "";

	return (
		<aside className="flex shrink-0 flex-col border-border bg-card/40 max-md:w-full max-md:border-b md:w-[280px] md:border-r">
			{/* 移动端折叠头（桌面隐藏） */}
			<button
				type="button"
				onClick={() => setMobileOpen((v) => !v)}
				className="flex items-center gap-2 px-3 py-2 md:hidden"
				aria-label={mobileOpen ? "折叠患者区" : "展开患者区"}
			>
				<img
					src={avatarSrc}
					alt={name}
					className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border bg-muted"
				/>
				<span className="flex-1 truncate text-left text-sm font-semibold">{name}</span>
				{mobileOpen ? (
					<ChevronUp className="size-4 shrink-0 text-muted-foreground" />
				) : (
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				)}
			</button>

			{/* 内容（移动端可折叠，桌面常显） */}
			<div
				className={cn(
					"min-h-0 flex-col gap-4 overflow-y-auto p-4",
					mobileOpen ? "flex" : "hidden md:flex",
				)}
			>
				{/* 患者主视觉 — 静态头像（论文病例写实 PNG，其余默认简洁头像） */}
				<div className="flex justify-center">
					<img
						src={avatarSrc}
						alt={name}
						className="size-[200px] rounded-2xl object-cover ring-1 ring-border bg-muted"
					/>
				</div>

				{/* 情绪标签 + 4D 条 + 主动追问进度（情绪栏整体迁入） */}
				<EmotionIndicator
					bus={bus}
					capabilities={capabilities}
					recordId={recordId}
					trailing={<InquiryProgressChip />}
				/>

				{/* 患者信息块（原 PatientInfoTool 内容） */}
				<div className="space-y-1 rounded-lg border border-border p-3">
					<p className="text-sm font-semibold">{name}</p>
					<p className="text-xs text-muted-foreground">
						{[age ? `${age}岁` : "", gender].filter(Boolean).join(" · ")}
					</p>
					{chiefComplaint && <p className="text-xs text-muted-foreground">主诉：{chiefComplaint}</p>}
				</div>
			</div>
		</aside>
	);
}
