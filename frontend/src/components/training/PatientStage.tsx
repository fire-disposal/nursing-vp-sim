import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrainingStore } from "@/stores/trainingStore";
import { EmotionIndicator } from "./EmotionIndicator";
import { InquiryProgressChip } from "./InquiryProgressChip";
import { appearanceForPatient } from "./face/appearance";
import { faceConfigFrom4D } from "./face/expressionMap";
import { premiumExtrasFrom4D } from "./face/premiumExtras";
import PremiumFaceArtwork from "./face/PremiumFaceArtwork";

/**
 * PatientStage — 患者区（训练三区布局的一级区域，观察对象）。
 *
 * 布局反思：对话不再独占页面——患者区与对话区并列。
 * 区内聚合了此前分散的三处患者呈现：
 *   头部立绘 → 大脸（200px，情绪驱动 + 眨眼）
 *   情绪栏   → EmotionIndicator（标签 + 4D 条 + 主动追问轮询）
 *   工具面板 PatientInfoTool → 信息块（姓名/年龄/性别/主诉）
 * 桌面：固定 280px 左栏；移动端：顶部区，可折叠成紧凑条。
 */

export default function PatientStage() {
	const [mobileOpen, setMobileOpen] = useState(true);
	const bus = useTrainingStore((s) => s.bus)!;
	const capabilities = useTrainingStore((s) => s.capabilities);
	const recordId = Number(useTrainingStore((s) => s.recordId));
	const patient = useTrainingStore((s) => s.patient);
	const label = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);

	const values = useMemo(
		() => ({ trust, anxiety, irritation, cooperation }),
		[trust, anxiety, irritation, cooperation],
	);
	const appearance = useMemo(
		() => appearanceForPatient(patient?.age, patient?.gender),
		[patient?.age, patient?.gender],
	);
	const cfg = useMemo(() => faceConfigFrom4D(label, values), [label, values]);
	const extras = useMemo(() => premiumExtrasFrom4D(label, values), [label, values]);

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
				<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={36} />
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
				{/* 大脸 — 患者主视觉 */}
				<div className="flex justify-center">
					<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={200} />
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
