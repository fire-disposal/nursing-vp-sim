import { useMemo, useState } from "react";
import { Box, Stack, Text, Transition } from "@mantine/core";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp } from "@tabler/icons-react";
import { usePatientData, useRecordFeatures, useRecordMeta } from "@/engine/TrainingDataContext";
import { useIsMobile, usePatientStageMode } from "@/hooks/useLayoutMode";
import { useTrainingStore } from "@/stores/trainingStore";
import { EmotionIndicator } from "./EmotionIndicator";
import { InquiryProgressChip } from "./InquiryProgressChip";
import PatientPresenter from "./presentation/PatientPresenter";
import { buildPatientPresentation } from "./presentation/build";

/** 患者区展开宽度（桌面完整形态 / 紧凑形态展开大图） */
const STAGE_WIDTH = 280;
/** 桌面收起后的窄条宽度 */
const STAGE_RAIL_WIDTH = 56;
/** 紧凑形态（横屏手机）收起后的窄条宽度：只留头像 + 姓名 + 把手 */
const COMPACT_RAIL_WIDTH = 88;

/**
 * PatientStage — 患者区（训练三区布局的一级区域，观察对象）。
 *
 * 两种形态，由 `usePatientStageMode()` 按**可用空间**选择：
 *
 * - `full`（宽屏且非矮视口）：280px 方框，可收起为 56px 窄条；宽度过渡 + 内容淡入淡出。
 *   - 展开态：右侧边缘垂直居中的收起把手。
 *   - 收起态：只留展开把手，不显示头像。
 * - `compact`（手机宽度 < 768px 或矮视口 ≤ 500px）：收为紧凑头（小头像 + 姓名/主诉一行），
 *   大图**按需展开**。原因：竖屏下「患者大图 + 能力条 + 完成阻断条 + 输入框」四层堆叠会把开场卡
 *   挤到不可读；横屏手机（844x390）的左栏大图会吃掉本就不高的视口。
 *   - 竖屏（堆叠布局，患者区在对话区上方）：紧凑头下方常驻一条 compact 情绪行
 *     —— 情绪是持续观察项，不能因为收起大图而丢失；
 *   - 横屏（rail 布局，患者区在左）：收起为 88px 窄条（给开场卡正文让出宽度），展开才占 280px。
 */
export default function PatientStage() {
	const compact = usePatientStageMode() === "compact";
	// 堆叠布局（患者区在对话区上方，宽 < sm 断点）vs rail 布局（患者区在左，与对话区并排）
	const stacked = useIsMobile();
	const [compactOpen, setCompactOpen] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(true);
	const [desktopOpen, setDesktopOpen] = useState(true);
	const bus = useTrainingStore((s) => s.bus)!;
	const features = useRecordFeatures();
	const recordId = Number(useTrainingStore((s) => s.recordId));
	const patient = usePatientData();
	const emotion = useTrainingStore((s) => s.emotion);
	const emotion4D = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const { mode } = useRecordMeta();

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

	// 紧凑形态默认收起（大图按需展开）；完整形态沿用「竖向折叠 + 桌面收起」两级状态
	const headOpen = compact ? compactOpen : mobileOpen;
	const contentOpen = compact ? compactOpen : mobileOpen && desktopOpen;
	// 紧凑形态展开后可以看到主诉；横屏窄条（88px）放不下主诉
	const showComplaint = !compact || stacked || compactOpen;
	// 情绪行：竖屏紧凑形态常驻在紧凑头下方；其余情况在展开内容里
	const inlineEmotion = compact && stacked;
	const showEmotion = mode !== "assessment";
	// 堆叠布局整宽；并排布局按形态给宽度（紧凑收起 88px 给开场卡正文让位）
	const sideWidth = compact
		? compactOpen
			? STAGE_WIDTH
			: COMPACT_RAIL_WIDTH
		: desktopOpen
			? STAGE_WIDTH
			: STAGE_RAIL_WIDTH;
	const width = stacked ? "100%" : sideWidth;

	return (
		<Box
			component="aside"
			data-patient-stage
			data-patient-mode={compact ? "compact" : "full"}
			style={{
				width,
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
			{/* 患者区头部：紧凑形态的主入口（横屏为竖向窄条），宽屏下是移动端折叠头 */}
			<Box
				component="button"
				type="button"
				onClick={() => (compact ? setCompactOpen((v) => !v) : setMobileOpen((v) => !v))}
				data-patient-stage-head
				aria-label={headOpen ? "折叠患者区" : "展开患者区"}
				aria-expanded={headOpen}
				display={compact ? "flex" : { base: "flex", sm: "none" }}
				style={{
					alignItems: "center",
					flexDirection: compact && !stacked && !compactOpen ? "column" : "row",
					justifyContent: compact && !stacked && !compactOpen ? "center" : "flex-start",
					gap: compact && !stacked && !compactOpen ? 6 : 12,
					width: "100%",
					minHeight: 44,
					padding: compact && !stacked && !compactOpen ? "10px 6px" : "10px 12px",
					textAlign: "left",
					background: "transparent",
					border: "none",
					cursor: "pointer",
				}}
			>
				<PatientPresenter presentation={presentation} size={compact ? 36 : 40} rounded="full" />
				<Box style={{ minWidth: 0, flex: 1, textAlign: compact && !stacked && !compactOpen ? "center" : "left" }}>
					<Text size="sm" fw={600} truncate>
						{name}
					</Text>
					{chiefComplaint && showComplaint && (
						<Text size="11px" c="dimmed" truncate mt={1}>
							主诉：{chiefComplaint}
						</Text>
					)}
				</Box>
				{headOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
			</Box>

			{/* 竖屏紧凑形态：情绪行常驻（不随大图收起而消失） */}
			{inlineEmotion && showEmotion && (
				<EmotionIndicator
					bus={bus}
					features={features}
					recordId={recordId}
					compact
					trailing={<InquiryProgressChip />}
				/>
			)}

			{/* 展开内容：桌面完整形态（大脸 + 情绪），或紧凑形态「按需看大图」 */}
			<Transition mounted={contentOpen} transition="fade" duration={220} keepMounted={false}>
				{(styles) => (
					<Box
						data-patient-stage-content
						style={{
							...styles,
							display: compact || mobileOpen ? "flex" : "none",
							flexDirection: "column",
							gap: 16,
							padding: compact ? "0 16px 16px" : 16,
						}}
					>
						{/* 并排/紧凑形态的大脸 — 诊室背板：柔和临床青绿径向渐变，像床头观察区 */}
						<Box
							display={{ base: "none", sm: "flex" }}
							style={{
								justifyContent: "center",
								borderRadius: "var(--mantine-radius-lg)",
								background:
									"radial-gradient(120% 100% at 50% 0%, var(--mantine-color-brand-light) 0%, var(--mantine-color-body) 72%)",
								border: "1px solid var(--mantine-color-brand-outline)",
								padding: "18px 10px 10px",
							}}
						>
							<PatientPresenter presentation={presentation} fill />
						</Box>
						{/* 堆叠布局（竖屏）的大脸：紧凑形态展开时才渲染 */}
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

						{showEmotion && !inlineEmotion && (
							<EmotionIndicator
								bus={bus}
								features={features}
								recordId={recordId}
								trailing={<InquiryProgressChip />}
							/>
						)}
					</Box>
				)}
			</Transition>

			{/* 收起把手（桌面完整形态展开态）：右侧边缘垂直居中 */}
			{!compact && desktopOpen && (
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
						background: "var(--mantine-color-default-hover)",
						color: "var(--mantine-color-dimmed)",
						cursor: "pointer",
					}}
				>
					<IconChevronLeft size={14} />
				</Box>
			)}

			{/* 桌面完整形态收起态：窄条把手（不显示头像），点击展开 */}
			<Transition mounted={!compact && !desktopOpen} transition="fade" duration={220} keepMounted={false}>
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
