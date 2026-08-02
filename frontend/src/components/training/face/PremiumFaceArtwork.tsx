import { useId, type CSSProperties } from "react";
import type { FaceConfig } from "./expressionMap";
import type { PremiumExtras } from "./premiumExtras";
import "./blink.css";

/**
 * PremiumFaceArtwork — 高级参数化患者脸（分层 SVG 插画）。
 *
 * 与 PatientFace 消费同一 FaceConfig 契约，但渲染档次完全不同：
 * 渐变皮肤/前后发/虹膜+瞳孔+高光/眼睑/唇部/颊红/泪痕/汗滴/头倾角/皱眉纹。
 * 纯几何函数：props in → SVG out，无 store、无副作用，可直接单测/复用。
 */

interface PremiumFaceArtworkProps {
	cfg: FaceConfig;
	extras: PremiumExtras;
	size?: number;
	className?: string;
	/** 眨眼动画（默认开）；纯 CSS，尊重 reduced-motion */
	blink?: boolean;
	/** 眨眼周期 ms（默认 4500） */
	blinkInterval?: number;
}

// ── 调色板 ──
const SKIN_LIGHT = "#f8d6b4";
const SKIN_MID = "#f0bd92";
const SKIN_DEEP = "#dca06f";
const HAIR_DARK = "#33231a";
const HAIR_MID = "#4e3526";
const HAIR_LIGHT = "#6b4c38";
const BROW = "#3a271c";
const SCLERA = "#fdf8f0";
const IRIS_DARK = "#3a2110";
const IRIS_MID = "#6b4423";
const LIP_UP = "#cf6d5d";
const LIP_DOWN = "#a94a3e";
const MOUTH_INNER = "#5a2e2a";
const BLUSH = "#e8837f";
const TEAR = "#7ec8f2";
const SWEAT = "#8fd3f5";

/** 脸部轮廓 — 上宽下窄的蛋形，下巴 166 */
const FACE_PATH =
	"M 100 38 C 138 38 160 62 160 98 C 160 128 138 158 100 166 C 62 158 40 128 40 98 C 40 62 62 38 100 38 Z";

/** 颈 + 肩（画在脸后面，露出下巴以下） */
const NECK_SHOULDER_PATH =
	"M 84 148 L 116 148 L 120 170 L 80 170 Z";

/** 短发 — 平滑发帽，前额可见（患者短发；底缘远离眉毛，零重叠） */
const SHORT_HAIR_PATH =
	"M 44 62 C 44 34 68 20 100 20 C 132 20 156 34 156 62 " +
	"Q 156 52 146 48 Q 132 42 116 44 Q 104 46 100 50 Q 96 46 84 44 " +
	"Q 68 42 54 48 Q 44 52 44 62 Z";

function Eye({
	cx,
	openness,
	shape,
	lid,
	irisShift,
	gradientId,
}: {
	cx: number;
	openness: number;
	shape: FaceConfig["eyeShape"];
	lid: number;
	irisShift: PremiumExtras["irisShift"];
	gradientId: string;
}) {
	const cy = 92;
	const closed = openness < 0.35;
	// 眼高：正常 6+12*openness；wide 再加高 2；narrow 压缩
	const h = shape === "wide" ? 8 + 13 * openness : 6 + 12 * openness;
	const upper = cy - h / 2 - (shape === "wide" ? 1.5 : 0);
	const lower = cy + h / 2 + lid * 4; // lid：上睑下压使缝变窄
	const irisR = 7;
	const shiftY = irisShift === "down" ? 2.5 : 0;
	const shiftX = irisShift === "away" ? (cx < 100 ? -2.5 : 2.5) : 0;

	if (closed) {
		// 闭眼：一条向下弯的眼睑线 + 下睑线
		return (
			<g>
				<path
					d={`M ${cx - 10} ${upper} Q ${cx} ${upper + 7} ${cx + 10} ${upper}`}
					stroke={BROW}
					strokeWidth={3.5}
					fill="none"
					strokeLinecap="round"
				/>
				<path
					d={`M ${cx - 7} ${lower - 2} Q ${cx} ${lower + 1} ${cx + 7} ${lower - 2}`}
					stroke={BROW}
					strokeWidth={1.6}
					opacity={0.5}
					fill="none"
					strokeLinecap="round"
				/>
			</g>
		);
	}

	if (shape === "curve") {
		// 开心眯眼：上扬弧线
		return (
			<g>
				<path
					d={`M ${cx - 10} ${upper} Q ${cx} ${upper - 4} ${cx + 10} ${upper}`}
					stroke={BROW}
					strokeWidth={3.8}
					fill="none"
					strokeLinecap="round"
				/>
			</g>
		);
	}

	return (
		<g>
			{/* 眼白（被眼睑裁剪） */}
			<clipPath id={`${gradientId}-clip-${cx}`}>
				<rect x={cx - 11} y={upper - 1} width={22} height={lower - upper + 2} rx={6} />
			</clipPath>
			<rect
				x={cx - 11}
				y={upper - 1}
				width={22}
				height={lower - upper + 2}
				rx={6}
				fill={SCLERA}
				clipPath={`url(#${gradientId}-clip-${cx})`}
			/>
			<g clipPath={`url(#${gradientId}-clip-${cx})`}>
				{/* 虹膜 + 瞳孔 + 高光 */}
				<circle cx={cx + shiftX} cy={cy + shiftY} r={irisR} fill={`url(#${gradientId}-iris)`} />
				<circle cx={cx + shiftX} cy={cy + shiftY} r={3.4} fill={IRIS_DARK} />
				<circle cx={cx + shiftX - 2} cy={cy + shiftY - 2.2} r={1.7} fill="#fff" opacity={0.92} />
				{/* 下睑反光 */}
				<path
					d={`M ${cx - 8} ${lower - 1} Q ${cx} ${lower + 1} ${cx + 8} ${lower - 1}`}
					stroke="#fff"
					strokeWidth={1.2}
					opacity={0.55}
					fill="none"
				/>
			</g>
			{/* 上睑（厚度 + 外侧睫毛） */}
			<path
				d={`M ${cx - 11} ${upper} Q ${cx} ${upper - 2.5 - lid * 3} ${cx + 11} ${upper + (lid > 0.4 ? 2 : 0)}`}
				stroke={BROW}
				strokeWidth={3.4}
				fill="none"
				strokeLinecap="round"
			/>
			{/* 下睑线 */}
			<path
				d={`M ${cx - 9} ${lower} Q ${cx} ${lower + 2} ${cx + 9} ${lower}`}
				stroke={BROW}
				strokeWidth={1.5}
				opacity={0.45}
				fill="none"
				strokeLinecap="round"
			/>
		</g>
	);
}

export default function PremiumFaceArtwork({
	cfg,
	extras,
	size = 64,
	className,
	blink = true,
	blinkInterval = 4500,
}: PremiumFaceArtworkProps) {
	const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
	const { browAngle: a, eyeOpenness: o, eyeShape, mouth, blush, tears } = cfg;
	const { headTilt, sweat, furrow } = extras;

	const blinkStyle = { "--blink-interval": `${blinkInterval}ms` } as CSSProperties;
	// 眨眼仅在睁眼椭圆形态下启用：闭弧（openness<0.35）与笑眯眼（curve）已是"闭眼"观感，叠加压合会双重关闭
	const blinkClass = blink && o >= 0.35 && eyeShape !== "curve" ? "face-blink" : undefined;

	// 眉毛：外端微动、拱点随张力、内端随 browAngle（负 = 内端下压/怒）
	const browLeft = (cx: number, by: number) =>
		`M ${cx - 18} ${by + 1} Q ${cx} ${by - 3 - a * 4} ${cx + 14} ${by - a * 10}`;
	const browRight = (cx: number, by: number) =>
		`M ${cx + 18} ${by + 1} Q ${cx} ${by - 3 - a * 4} ${cx - 14} ${by - a * 10}`;

	const mouthElement = (() => {
		switch (mouth) {
			case "smile":
				return (
					<g>
						<path d="M 80 126 C 92 120 108 120 120 126 C 108 130 92 130 80 126 Z" fill={`url(#${uid}-lip)`} />
						<path d="M 88 129 Q 100 136 112 129" stroke={LIP_DOWN} strokeWidth={2} fill="none" opacity={0.5} />
					</g>
				);
			case "frown":
				return (
					<g>
						<path d="M 80 132 C 92 138 108 138 120 132 C 108 128 92 128 80 132 Z" fill={`url(#${uid}-lip)`} />
					</g>
				);
			case "tight":
				return (
					<g>
						<path d="M 88 128 L 112 128" stroke={LIP_DOWN} strokeWidth={4.5} strokeLinecap="round" />
						<path d="M 94 142 Q 100 145 106 142" stroke={BROW} strokeWidth={1.8} opacity={0.28} fill="none" />
					</g>
				);
			case "open":
				return (
					<g>
						<ellipse cx="100" cy="130" rx="7.5" ry="6.5" fill={MOUTH_INNER} />
						<rect x="93" y="125.5" width="14" height="2.6" rx="1.3" fill="#f7ede0" />
						<path d="M 95 132 Q 100 136 105 132" stroke="#d98b7d" strokeWidth={2.4} fill="none" strokeLinecap="round" />
					</g>
				);
			default:
				return <path d="M 82 128 Q 100 131 118 128" stroke={LIP_DOWN} strokeWidth={4} fill="none" strokeLinecap="round" />;
		}
	})();

	return (
		<svg
			viewBox="0 0 200 200"
			width={size}
			height={size}
			className={className}
			style={blinkStyle}
			role="img"
			aria-label="患者表情"
		>
			<defs>
				<radialGradient id={`${uid}-skin`} cx="0.36" cy="0.28" r="0.95">
					<stop offset="0%" stopColor={SKIN_LIGHT} />
					<stop offset="62%" stopColor={SKIN_MID} />
					<stop offset="100%" stopColor={SKIN_DEEP} />
				</radialGradient>
				<linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="0.25" y2="1">
					<stop offset="0%" stopColor={HAIR_MID} />
					<stop offset="55%" stopColor={HAIR_DARK} />
					<stop offset="100%" stopColor={HAIR_LIGHT} />
				</linearGradient>
				<radialGradient id={`${uid}-iris`} cx="0.4" cy="0.35" r="0.9">
					<stop offset="0%" stopColor={IRIS_MID} />
					<stop offset="70%" stopColor={IRIS_DARK} />
					<stop offset="100%" stopColor="#241409" />
				</radialGradient>
				<linearGradient id={`${uid}-lip`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor={LIP_UP} />
					<stop offset="100%" stopColor={LIP_DOWN} />
				</linearGradient>
				<radialGradient id={`${uid}-blush`} cx="0.5" cy="0.5" r="0.5">
					<stop offset="0%" stopColor={BLUSH} stopOpacity="0.55" />
					<stop offset="100%" stopColor={BLUSH} stopOpacity="0" />
				</radialGradient>
			</defs>

			<g transform={`rotate(${headTilt} 100 100)`}>
				{/* 颈肩 */}
				<path d={NECK_SHOULDER_PATH} fill={SKIN_DEEP} />
				<path d="M 80 170 L 120 170 L 126 184 L 74 184 Z" fill="#dfe7ee" />
				{/* 耳朵（内侧被脸覆盖；拉高为耳廓比例） */}
				<ellipse cx="37" cy="96" rx="4" ry="9.5" fill={SKIN_DEEP} />
				<ellipse cx="163" cy="96" rx="4" ry="9.5" fill={SKIN_DEEP} />
				<path d="M 36 92 Q 39.5 96 36 100" stroke={SKIN_MID} strokeWidth={1.3} fill="none" strokeLinecap="round" />
				<path d="M 164 92 Q 160.5 96 164 100" stroke={SKIN_MID} strokeWidth={1.3} fill="none" strokeLinecap="round" />
				{/* 脸 */}
				<path d={FACE_PATH} fill={`url(#${uid}-skin)`} />
				{/* 短发（画在脸前，眉眼之下；整体下移 9px 压低发际线） */}
				<g transform="translate(0 9)">
					<path d={SHORT_HAIR_PATH} fill={`url(#${uid}-hair)`} />
					<path d="M 84 32 Q 100 27 116 32" stroke={HAIR_LIGHT} strokeWidth={1.6} opacity={0.3} fill="none" strokeLinecap="round" />
				</g>
				{/* 额头发光（下移到可见前额区） */}
				<ellipse cx="100" cy="72" rx="13" ry="5" fill="#fff" opacity="0.1" />
				{/* 颊下阴影（下巴） */}
				<ellipse cx="100" cy="146" rx="30" ry="10" fill={SKIN_DEEP} opacity="0.16" />

				{/* 颊红 */}
				{blush && (
					<>
						<ellipse cx="60" cy="118" rx="11" ry="6.5" fill={`url(#${uid}-blush)`} />
						<ellipse cx="140" cy="118" rx="11" ry="6.5" fill={`url(#${uid}-blush)`} />
					</>
				)}

				{/* 泪痕 + 泪滴 */}
				{tears && (
					<>
						<path d="M 64 106 C 60 118 58 128 62 138" stroke={TEAR} strokeWidth={2.4} opacity={0.35} fill="none" strokeLinecap="round" />
						<path d="M 136 106 C 140 118 142 128 138 138" stroke={TEAR} strokeWidth={2.4} opacity={0.35} fill="none" strokeLinecap="round" />
						<path transform="translate(63 100)" d="M 0 -5 C 3.2 -1.8 5 1.2 5 3.8 C 5 6.4 2.8 8.4 0 8.4 C -2.8 8.4 -5 6.4 -5 3.8 C -5 1.2 -3.2 -1.8 0 -5 Z" fill={TEAR} opacity="0.9" />
						<path transform="translate(137 100)" d="M 0 -5 C 3.2 -1.8 5 1.2 5 3.8 C 5 6.4 2.8 8.4 0 8.4 C -2.8 8.4 -5 6.4 -5 3.8 C -5 1.2 -3.2 -1.8 0 -5 Z" fill={TEAR} opacity="0.9" />
					</>
				)}

				{/* 汗滴（焦虑） */}
				{sweat && (
					<path transform="translate(50 84) rotate(12)" d="M 0 -4 C 2.6 -1.4 4 1 4 3.2 C 4 5.4 2.2 7.2 0 7.2 C -2.2 7.2 -4 5.4 -4 3.2 C -4 1 -2.6 -1.4 0 -4 Z" fill={SWEAT} opacity="0.85" />
				)}

				{/* 眉毛 */}
				<path d={browLeft(70, 74)} stroke={BROW} strokeWidth={5} fill="none" strokeLinecap="round" />
				<path d={browRight(130, 74)} stroke={BROW} strokeWidth={5} fill="none" strokeLinecap="round" />
				{/* 皱眉纹（11 字） */}
				{furrow && (
					<>
						<path d="M 94 80 L 96 87" stroke={BROW} strokeWidth={2} opacity={0.4} strokeLinecap="round" />
						<path d="M 104 80 L 102 87" stroke={BROW} strokeWidth={2} opacity={0.4} strokeLinecap="round" />
					</>
				)}

				{/* 眼睛（眨眼动画挂在包裹双眼的同一组上，保证同步） */}
				<g className={blinkClass}>
					<Eye cx={70} openness={o} shape={eyeShape} lid={extras.eyeLid} irisShift={extras.irisShift} gradientId={uid} />
					<Eye cx={130} openness={o} shape={eyeShape} lid={extras.eyeLid} irisShift={extras.irisShift} gradientId={uid} />
				</g>

				{/* 鼻子 — 桥线 + 鼻翼阴影 */}
				<path d="M 100 82 L 100 104" stroke={BROW} strokeWidth={1.5} opacity={0.14} strokeLinecap="round" />
				<path d="M 93 111 Q 97 114 101 111" stroke={BROW} strokeWidth={1.5} opacity={0.22} fill="none" strokeLinecap="round" />
				<path d="M 99 111 Q 103 114 107 111" stroke={BROW} strokeWidth={1.5} opacity={0.22} fill="none" strokeLinecap="round" />

				{/* 嘴 */}
				{mouthElement}
			</g>
		</svg>
	);
}
