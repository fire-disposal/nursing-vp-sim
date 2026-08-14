import { useMemo, useState } from "react";
import { Box, Stack, Text, Transition } from "@mantine/core";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp } from "@tabler/icons-react";
import { useTrainingStore } from "@/stores/trainingStore";
import { EmotionIndicator } from "./EmotionIndicator";
import { InquiryProgressChip } from "./InquiryProgressChip";
import PatientPresenter from "./presentation/PatientPresenter";
import { buildPatientPresentation } from "./presentation/build";

/**
 * PatientStage — 患者区（训练三区布局的一级区域，观察对象）。
 *
 * 桌面：280px 方框，可收起为 56px 窄条；宽度过渡 + 内容淡入淡出。
 *   - 展开态：右侧边缘垂直居中的收起把手。
 *   - 收起态：只留展开把手，不显示头像。
 * 移动端：顶部紧凑信息条（头像 + 姓名），可折叠。
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
	const chiefComplaint = (patient as { chiefComplaint?: string } | null)?.chiefComplaint;

	return (
		<Box
			component="aside"
			w={{ base: "100%", sm: desktopOpen ? 280 : 56 }}
			style={{
				position: "relative",
				display: "flex",
				flexDirection: "column",
				flexShrink: 0,
				background: "var(--mantine-color-body)",
				borderBottom: "1px solid var(--mantine-color-default-border)",
				overflowX: "hidden",
				overflowY: "auto",
				transition: "width 300ms ease",
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
					<Text size="sm" fw={600} truncate>
						{name}
					</Text>
					{chiefComplaint && (
						<Text size="11px" c="dimmed" truncate mt={1}>
							主诉：{chiefComplaint}
						</Text>
					)}
				</Box>
				{mobileOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
			</Box>

			{/* 桌面展开态：大脸 + 情绪 */}
			<Transition mounted={desktopOpen} transition="fade" duration={220} keepMounted={false}>
				{(styles) => (
					<Box
						data-patient-stage-content
						style={{
							...styles,
							display: mobileOpen ? "flex" : "none",
							flexDirection: "column",
							gap: 16,
							padding: 16,
						}}
					>
						{/* 桌面大脸 — 诊室背板：柔和临床青绿径向渐变，像床头观察区 */}
						<Box
							display={{ base: "none", sm: "flex" }}
							style={{
								justifyContent: "center",
								borderRadius: "var(--mantine-radius-lg)",
								background:
									"radial-gradient(120% 100% at 50% 0%, var(--mantine-color-brand-0) 0%, var(--mantine-color-body) 72%)",
								border: "1px solid var(--mantine-color-brand-1)",
								padding: "18px 10px 10px",
							}}
						>
							<PatientPresenter presentation={presentation} fill />
						</Box>
						<Box display={{ base: "flex", sm: "none" }} style={{ justifyContent: "center" }}>
							<PatientPresenter presentation={presentation} size={160} />
						</Box>

						<Stack display={{ base: "none", sm: "flex" }} gap={2} ta="center">
							<Text size="sm" fw={700}>
								{name}
							</Text>
							{chiefComplaint && (
								<Text size="xs" c="dimmed" lineClamp={2} lh={1.5}>
									主诉：{chiefComplaint}
								</Text>
							)}
						</Stack>

						<EmotionIndicator
							bus={bus}
							capabilities={capabilities}
							recordId={recordId}
							trailing={<InquiryProgressChip />}
						/>
					</Box>
				)}
			</Transition>

			{/* 收起把手（桌面展开态）：右侧边缘垂直居中 */}
			{desktopOpen && (
				<Box
					component="button"
					type="button"
					onClick={() => setDesktopOpen(false)}
					aria-label="收起患者区"
					display={{ base: "none", sm: "flex" }}
					style={{
						position: "absolute",
						right: 0,
						top: "50%",
						transform: "translateY(-50%)",
						width: 20,
						height: 48,
						alignItems: "center",
						justifyContent: "center",
						border: "none",
						borderRadius: "8px 0 0 8px",
						background: "var(--mantine-color-gray-1)",
						color: "var(--mantine-color-dimmed)",
						cursor: "pointer",
					}}
				>
					<IconChevronLeft size={14} />
				</Box>
			)}

			{/* 桌面收起态：窄条把手（不显示头像），点击展开 */}
			<Transition mounted={!desktopOpen} transition="fade" duration={220} keepMounted={false}>
				{(styles) => (
					<Box
						component="button"
						type="button"
						onClick={() => setDesktopOpen(true)}
						aria-label="展开患者区"
						display={{ base: "none", sm: "flex" }}
						style={{
							...styles,
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							width: "100%",
							flex: 1,
							background: "transparent",
							border: "none",
							cursor: "pointer",
						}}
					>
						<IconChevronRight size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
					</Box>
				)}
			</Transition>
		</Box>
	);
}
