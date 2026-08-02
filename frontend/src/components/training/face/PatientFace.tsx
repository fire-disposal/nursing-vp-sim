import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useTrainingStore } from "@/stores/trainingStore";
import { faceConfigFrom4D, type FaceConfig } from "./expressionMap";

/**
 * 患者虚拟表情 — 情绪信号灯的 SVG 消费者（"笨消费者"）。
 *
 * 数据源：trainingStore（与 EmotionIndicator 同源），零后端改动。
 * 生产者为既有的 4D 情绪状态机；本组件只是把 Emotion4DLabel + 数值
 * 渲染成一张参数化人脸。未知标签/情绪关闭时自动回退 neutral。
 */

interface PatientFaceProps {
	size?: number;
	className?: string;
}

const SKIN = "#f2c8a0";
const FEATURE = "#4a3326";
const BLUSH = "#f28f9d";
const TEAR = "#7ec8f2";

function FaceArtwork({ cfg, size }: { cfg: FaceConfig; size: number }) {
	const { browAngle: a, eyeOpenness: e, eyeShape, mouth } = cfg;

	// 眉毛：外端微动，内端随 browAngle 上下（负 = 下压/怒，正 = 上挑/焦虑）
	const browLeft = `M 30 ${36 + a * 2} Q 36 ${36 + a * 10} 44 ${36 - a * 8}`;
	const browRight = `M 70 ${36 + a * 2} Q 64 ${36 + a * 10} 56 ${36 - a * 8}`;

	// 眼睛：低开合画闭合弧线，否则画椭圆（形状由 eyeShape 决定）
	const eyeRy = 3 + 6 * e;
	const eyeRx = eyeShape === "narrow" ? 3.5 : 5;
	const eyePath = (x: number) => `M ${x - 5} 48 Q ${x} 53 ${x + 5} 48`;

	const mouthElement = (() => {
		switch (mouth) {
			case "smile":
				return <path d="M 38 62 Q 50 72 62 62" stroke={FEATURE} strokeWidth="3.5" fill="none" strokeLinecap="round" />;
			case "frown":
				return <path d="M 38 66 Q 50 56 62 66" stroke={FEATURE} strokeWidth="3.5" fill="none" strokeLinecap="round" />;
			case "tight":
				return <path d="M 44 64 L 56 64" stroke={FEATURE} strokeWidth="4" strokeLinecap="round" />;
			case "open":
				return <ellipse cx="50" cy="65" rx="5" ry="6.5" fill={FEATURE} />;
			default:
				return <path d="M 40 64 L 60 64" stroke={FEATURE} strokeWidth="3" strokeLinecap="round" />;
		}
	})();

	return (
		<svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="患者表情">
			{/* 头部 */}
			<circle cx="50" cy="52" r="40" fill={SKIN} />
			{/* 腮红 */}
			{cfg.blush && (
				<>
					<ellipse cx="33" cy="60" rx="5" ry="3" fill={BLUSH} opacity="0.5" />
					<ellipse cx="67" cy="60" rx="5" ry="3" fill={BLUSH} opacity="0.5" />
				</>
			)}
			{/* 眼泪 */}
			{cfg.tears && (
				<>
					<circle cx="36" cy="56" r="3" fill={TEAR} />
					<circle cx="64" cy="56" r="3" fill={TEAR} />
				</>
			)}
			{/* 眉毛 */}
			<path d={browLeft} stroke={FEATURE} strokeWidth="4.5" fill="none" strokeLinecap="round" />
			<path d={browRight} stroke={FEATURE} strokeWidth="4.5" fill="none" strokeLinecap="round" />
			{/* 眼睛 */}
			{e < 0.35 ? (
				<>
					<path d={eyePath(36)} stroke={FEATURE} strokeWidth="3" fill="none" strokeLinecap="round" />
					<path d={eyePath(64)} stroke={FEATURE} strokeWidth="3" fill="none" strokeLinecap="round" />
				</>
			) : (
				<>
					<ellipse cx="36" cy="48" rx={eyeRx} ry={eyeRy} fill={FEATURE} />
					<ellipse cx="64" cy="48" rx={eyeRx} ry={eyeRy} fill={FEATURE} />
				</>
			)}
			{/* 嘴 */}
			{mouthElement}
		</svg>
	);
}

export default function PatientFace({ size = 40, className }: PatientFaceProps) {
	const label = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);

	const cfg = useMemo(
		() => faceConfigFrom4D(label, { trust, anxiety, irritation, cooperation }),
		[label, trust, anxiety, irritation, cooperation],
	);

	return (
		<div className={cn("shrink-0", className)} title="患者表情">
			<FaceArtwork cfg={cfg} size={size} />
		</div>
	);
}
