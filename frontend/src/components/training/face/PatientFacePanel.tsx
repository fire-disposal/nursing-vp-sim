import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useTrainingStore } from "@/stores/trainingStore";
import { appearanceForPatient } from "./appearance";
import { faceConfigFrom4D } from "./expressionMap";
import { premiumExtrasFrom4D } from "./premiumExtras";
import PremiumFaceArtwork from "./PremiumFaceArtwork";

/**
 * PatientFacePanel — 训练级患者表情（常驻小方块 + 轻量弹出）。
 *
 * 定位：全局患者呈现组件，不在 tools 协议内（脸是被观察对象，无需
 * case 字段激活；按患者年龄/性别自动适配外观）。
 * 交互：常驻一个小方块脸（桌面左缘 / 移动端上部），点击弹出大脸，
 * 不遮挡内容区（轻量 popover，非全高抽屉）。
 * 情绪展示归 EmotionIndicator（情绪栏）——面板不做重复文字展示。
 */

export default function PatientFacePanel() {
	const [open, setOpen] = useState(false);
	const label = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const patient = useTrainingStore((s) => s.patient);

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

	return (
		<>
			{/* 常驻小方块：桌面左缘垂直居中 / 移动端上部（头部之下） */}
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label={open ? "折叠患者表情" : "展开患者表情"}
				className={cn(
					"absolute z-30 rounded-lg border border-border bg-background/95 p-0.5 shadow-md transition-transform hover:scale-105",
					"left-2 top-1/2 -translate-y-1/2",
					"max-md:left-auto max-md:right-3 max-md:top-12 max-md:-translate-y-0",
				)}
			>
				<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={44} />
			</button>

			{/* 轻量弹出：大脸（不遮内容区的锚定 popover） */}
			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, scale: 0.9 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.9 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className={cn(
							"absolute z-40 flex flex-col items-center rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur",
							"left-14 top-1/2 -translate-y-1/2",
							"max-md:left-1/2 max-md:right-auto max-md:top-16 max-md:-translate-x-1/2 max-md:-translate-y-0",
						)}
					>
						<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={150} />
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
}
