import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useTrainingStore } from "@/stores/trainingStore";
import { appearanceForPatient } from "./appearance";
import { faceConfigFrom4D } from "./expressionMap";
import { premiumExtrasFrom4D } from "./premiumExtras";
import PremiumFaceArtwork from "./PremiumFaceArtwork";

/**
 * PatientFacePanel — 训练级患者表情（左侧弹出抽屉）。
 *
 * 定位：全局患者呈现组件，不在 tools 协议内（脸是被观察对象，无需
 * case 字段激活；按患者年龄/性别自动适配外观）。
 * 交互：平时只显示一个展开按钮；点击后左侧滑出大脸抽屉。
 * 情绪展示归 EmotionIndicator（情绪栏）——本面板不做任何重复展示，
 * 脸本身即情绪信号。
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
			{/* 平时只显示展开按钮（悬浮在训练区左缘） */}
			{!open && (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="absolute left-2 top-1/2 z-30 -translate-y-1/2 rounded-full border border-border bg-background/90 p-1 shadow-sm transition-colors hover:bg-muted"
					aria-label="展开患者表情"
				>
					<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={28} />
				</button>
			)}

			{/* 左侧滑出抽屉 */}
			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ x: -190 }}
						animate={{ x: 0 }}
						exit={{ x: -190 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
						className="absolute left-0 top-0 z-40 flex h-full w-[190px] flex-col items-center justify-center gap-4 border-r border-border bg-background/95 px-4 shadow-lg backdrop-blur"
					>
						<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={150} />
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
							aria-label="折叠患者表情"
						>
							<X className="size-4" />
						</button>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
}
