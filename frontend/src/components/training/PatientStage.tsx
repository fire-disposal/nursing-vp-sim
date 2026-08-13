import { useMemo, useState } from "react";
import { Box, Text } from "@mantine/core";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp } from "@tabler/icons-react";
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
		<Box
			component="aside"
			w={{ base: "100%", sm: desktopOpen ? 280 : 56 }}
			style={{
				display: "flex",
				flexDirection: "column",
				flexShrink: 0,
				background: "var(--mantine-color-body)",
				borderBottom: "1px solid var(--mantine-color-default-border)",
				overflowY: "auto",
			}}
		>
			{/* 移动端折叠头（桌面隐藏）：头像 + 姓名 */}
			<Box
				component="button"
				type="button"
				onClick={() => setMobileOpen((v) => !v)}
				display={{ base: "flex", sm: "none" }}
				style={{
					alignItems: "center",
					gap: 12,
					width: "100%",
					padding: "10px 12px",
					textAlign: "left",
					background: "transparent",
					border: "none",
					cursor: "pointer",
				}}
				aria-label={mobileOpen ? "折叠患者区" : "展开患者区"}
			>
				<PatientPresenter presentation={presentation} size={40} rounded="full" />
				<Box style={{ minWidth: 0, flex: 1 }}>
					<Text size="sm" fw={600} truncate>{name}</Text>
				</Box>
				{mobileOpen ? (
					<IconChevronUp size={16} style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }} />
				) : (
					<IconChevronDown size={16} style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }} />
				)}
			</Box>

			{/* 桌面展开态：表现内容（大脸 + 情绪） */}
			{desktopOpen && (
				<Box
					data-patient-stage-content
					className={mobileOpen ? "flex" : "hidden"}
					style={{ flexDirection: "column", gap: 16, padding: 16 }}
				>
					{/* 收起控件（桌面） */}
					<Box display={{ base: "none", sm: "flex" }} style={{ justifyContent: "flex-end" }}>
						<Box
							component="button"
							type="button"
							onClick={() => setDesktopOpen(false)}
							aria-label="收起患者区"
							style={{
								width: 24,
								height: 24,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								borderRadius: 4,
								border: "1px solid var(--mantine-color-default-border)",
								color: "var(--mantine-color-dimmed)",
								background: "transparent",
								cursor: "pointer",
							}}
						>
							<IconChevronLeft size={14} />
						</Box>
					</Box>

					{/* 桌面大脸 — 铺满方框宽，随侧边组件自适应 */}
					<Box display={{ base: "none", sm: "flex" }} style={{ justifyContent: "center" }}>
						<PatientPresenter presentation={presentation} fill />
					</Box>
					{/* 移动大脸 — 适中定尺寸，不占满整屏宽 */}
					<Box display={{ base: "flex", sm: "none" }} style={{ justifyContent: "center" }}>
						<PatientPresenter presentation={presentation} size={160} />
					</Box>

					{/* 姓名标签（年龄/性别/主诉由 Header / WelcomeScreen 承担，避免冗余） */}
					<Text display={{ base: "none", sm: "block" }} ta="center" size="sm" fw={600}>
						{name}
					</Text>

					{/* 情绪标签 + 4D 条 + 主动追问进度（情绪栏整体迁入） */}
					<EmotionIndicator
						bus={bus}
						capabilities={capabilities}
						recordId={recordId}
						trailing={<InquiryProgressChip />}
					/>
				</Box>
			)}

			{/* 桌面收起态：窄条把手，点击展开 */}
			{!desktopOpen && (
				<Box
					component="button"
					type="button"
					onClick={() => setDesktopOpen(true)}
					aria-label="展开患者区"
					display={{ base: "none", sm: "flex" }}
					style={{
						flexDirection: "column",
						alignItems: "center",
						gap: 12,
						padding: "16px 0",
						background: "transparent",
						border: "none",
						cursor: "pointer",
					}}
				>
					<PatientPresenter presentation={presentation} size={40} rounded="full" />
					<IconChevronRight size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
				</Box>
			)}
		</Box>
	);
}
