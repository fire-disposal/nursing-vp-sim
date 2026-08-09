import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrainingStore } from "@/stores/trainingStore";
import { EmotionIndicator } from "./EmotionIndicator";
import { InquiryProgressChip } from "./InquiryProgressChip";
import PatientPresenter from "./presentation/PatientPresenter";
import { buildPatientPresentation } from "./presentation/build";

/**
 * PatientStage — 患者区（训练三区布局的一级区域，观察对象）。
 *
 * 职责收敛：只承载"患者表现"（大脸 + 情绪指标）。身份信息（年龄/性别/主诉）
 * 由顶部 TrainingHeader（姓名 + 病例名）与 WelcomeScreen（完整身份）负责，
 * 本组件只保留姓名标签，避免整页 3 处冗余。
 *
 * 桌面：280px 直角方框，垂直居中靠左，可收起为窄条；移动端：顶部紧凑信息条可折叠。
 * 情绪变化通过 EmotionIndicator 的标签/指标表达，不更换人物。
 */

export default function PatientStage() {
	const [mobileOpen, setMobileOpen] = useState(true);
	const [desktopOpen, setDesktopOpen] = useState(true);
	const bus = useTrainingStore((s) => s.bus)!;
	const capabilities = useTrainingStore((s) => s.capabilities);
	const recordId = Number(useTrainingStore((s) => s.recordId));
	const patient = useTrainingStore((s) => s.patient);
	const emotion = useTrainingStore((s) => s.emotion);
	const emotion4D = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);

	const values = useMemo(
		() => ({ trust, anxiety, irritation, cooperation }),
		[trust, anxiety, irritation, cooperation],
	);
	const presentation = useMemo(
		() => buildPatientPresentation(patient, { emotion, emotion4D, values }),
		[patient, emotion, emotion4D, values],
	);
	const name = patient?.name ?? "患者";

	return (
		<aside
			className={cn(
				"flex shrink-0 flex-col border-border bg-card/40 max-md:w-full max-md:border-b",
				"md:absolute md:left-0 md:top-1/2 md:-translate-y-1/2 md:z-10",
				desktopOpen
					? "md:w-[280px] md:max-h-[calc(100%-2rem)] md:overflow-y-auto md:border md:p-4"
					: "md:w-14 md:border md:p-2",
			)}
		>
			{/* 移动端折叠头（桌面隐藏）：头像 + 姓名 */}
			<button
				type="button"
				onClick={() => setMobileOpen((v) => !v)}
				className="flex w-full items-center gap-3 px-3 py-2.5 text-left md:hidden"
				aria-label={mobileOpen ? "折叠患者区" : "展开患者区"}
			>
				<PatientPresenter presentation={presentation} size={40} rounded="full" />
				<span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
				{mobileOpen ? (
					<ChevronUp className="size-4 shrink-0 text-muted-foreground" />
				) : (
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				)}
			</button>

			{/* 桌面展开态：表现内容（大脸 + 情绪） */}
			{desktopOpen && (
				<div
					data-patient-stage-content
					className={cn(
						"flex-col gap-4 max-md:p-4",
						mobileOpen ? "flex" : "hidden md:flex",
					)}
				>
					{/* 收起控件（桌面） */}
					<div className="hidden justify-end md:flex">
						<button
							type="button"
							onClick={() => setDesktopOpen(false)}
							aria-label="收起患者区"
							className="flex size-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted"
						>
							<ChevronLeft size={14} />
						</button>
					</div>

					{/* 桌面大脸 — 铺满方框宽，随侧边组件自适应 */}
					<div className="hidden justify-center md:flex">
						<PatientPresenter presentation={presentation} fill />
					</div>
					{/* 移动大脸 — 适中定尺寸，不占满整屏宽 */}
					<div className="flex justify-center md:hidden">
						<PatientPresenter presentation={presentation} size={160} />
					</div>

					{/* 姓名标签（年龄/性别/主诉由 Header / WelcomeScreen 承担，避免冗余） */}
					<p className="hidden text-center text-sm font-semibold md:block">{name}</p>

					{/* 情绪标签 + 4D 条 + 主动追问进度（情绪栏整体迁入） */}
					<EmotionIndicator
						bus={bus}
						capabilities={capabilities}
						recordId={recordId}
						trailing={<InquiryProgressChip />}
					/>
				</div>
			)}

			{/* 桌面收起态：窄条把手，点击展开 */}
			{!desktopOpen && (
				<button
					type="button"
					onClick={() => setDesktopOpen(true)}
					aria-label="展开患者区"
					className="hidden flex-col items-center gap-3 py-4 md:flex"
				>
					<PatientPresenter presentation={presentation} size={40} rounded="full" />
					<ChevronRight size={16} className="text-muted-foreground" />
				</button>
			)}
		</aside>
	);
}
