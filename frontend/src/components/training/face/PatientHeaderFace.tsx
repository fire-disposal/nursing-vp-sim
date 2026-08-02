import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useTrainingStore } from "@/stores/trainingStore";
import { appearanceForPatient } from "./appearance";
import { faceConfigFrom4D } from "./expressionMap";
import { premiumExtrasFrom4D } from "./premiumExtras";
import PremiumFaceArtwork from "./PremiumFaceArtwork";

/**
 * PatientHeaderFace — 患者"活头像"，进驻训练头部替换静态立绘。
 *
 * 位置反思：脸不该悬浮在聊天内容之上（抽屉/浮动方块都是与布局打架），
 * 患者的形象本就住在头部身份区——把立绘换成情绪驱动的活脸，
 * 页面只有一个患者形象，无重复、无遮挡。点击弹出大脸。
 */

interface PatientHeaderFaceProps {
	name: string;
	className?: string;
}

export default function PatientHeaderFace({ name, className }: PatientHeaderFaceProps) {
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
		<div className={cn("relative shrink-0", className)}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label={open ? "折叠患者表情" : `查看${name}的表情`}
				title={name}
				className="block rounded-full bg-muted ring-2 ring-border transition-transform hover:scale-105"
			>
				<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={30} />
			</button>

			{/* 点击弹出大脸（锚定在头像下方，不遮挡头部） */}
			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: -6, scale: 0.95 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -6, scale: 0.95 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="absolute left-0 top-full z-40 mt-2 rounded-xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur"
					>
						<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={140} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
