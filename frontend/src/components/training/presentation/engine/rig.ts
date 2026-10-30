/**
 * 立绘 rig — 表现层绘制引擎的夹具数据（归一化 0..1，相对原图宽高）。
 *
 * 只描述「哪里是什么」，不描述怎么动（动在 `motion.ts`，画在 `draw.ts`）：
 *   - eyeL/eyeR：眼睛中心与半径（眨眼时眼皮要刚好盖住这块）；
 *   - mouth：原图嘴角处那条唇线的矩形（扁平画风要先把这条线擦掉再重绘）；
 *   - skin/lip：擦除与重绘用的两种底色。
 *
 * 只覆盖 10 张扁平插画。写实照片（realistic/*.png）不做：单张平面图没有可分离背景，
 * 能做的只有「轻微下颌」，投入产出不成比例，照片就保持静态图。
 *
 * 数据来源：`frontend/scripts/extract-rigs.py`。立绘换了必须重跑脚本，否则嘴/眼会落在
 * 错误位置——这里不做运行期猜测。
 */

export interface EyeRig {
	x: number;
	y: number;
	rx: number;
	ry: number;
}

export interface MouthRig {
	x: number;
	y: number;
	/** 原图唇线的宽/高（擦除范围按它放大）。 */
	w: number;
	h: number;
}

export interface PortraitRig {
	eyeL: EyeRig;
	eyeR: EyeRig;
	mouth: MouthRig;
	skin: string;
	lip: string;
}

const RIGS: Record<string, PortraitRig> = {
	nurse_female: { eyeL: { x: 0.416, y: 0.512, rx: 0.0215, ry: 0.0277 }, eyeR: { x: 0.582, y: 0.512, rx: 0.0208, ry: 0.0277 }, mouth: { x: 0.499, y: 0.63, w: 0.078, h: 0.007 }, skin: "#fedcbe", lip: "#e38f6e" },
	nurse_male: { eyeL: { x: 0.424, y: 0.486, rx: 0.021, ry: 0.0259 }, eyeR: { x: 0.595, y: 0.486, rx: 0.021, ry: 0.0259 }, mouth: { x: 0.508, y: 0.62, w: 0.087, h: 0.007 }, skin: "#fedcbe", lip: "#d98a66" },
	patient_child_female: { eyeL: { x: 0.399, y: 0.518, rx: 0.0257, ry: 0.0302 }, eyeR: { x: 0.585, y: 0.52, rx: 0.0242, ry: 0.0317 }, mouth: { x: 0.492, y: 0.637, w: 0.088, h: 0.009 }, skin: "#fed6b3", lip: "#d38964" },
	patient_child_male: { eyeL: { x: 0.397, y: 0.562, rx: 0.0227, ry: 0.0273 }, eyeR: { x: 0.577, y: 0.562, rx: 0.0212, ry: 0.0273 }, mouth: { x: 0.486, y: 0.673, w: 0.085, h: 0.009 }, skin: "#fdd6b3", lip: "#d18e6a" },
	patient_elder_female: { eyeL: { x: 0.399, y: 0.477, rx: 0.0225, ry: 0.0285 }, eyeR: { x: 0.583, y: 0.477, rx: 0.0225, ry: 0.0285 }, mouth: { x: 0.492, y: 0.625, w: 0.147, h: 0.006 }, skin: "#fdd6b2", lip: "#d3815f" },
	patient_elder_male: { eyeL: { x: 0.406, y: 0.457, rx: 0.0215, ry: 0.0261 }, eyeR: { x: 0.59, y: 0.457, rx: 0.0215, ry: 0.0261 }, mouth: { x: 0.498, y: 0.62, w: 0.11, h: 0.009 }, skin: "#fdd6b3", lip: "#d37e5e" },
	patient_middle_female: { eyeL: { x: 0.408, y: 0.47, rx: 0.0237, ry: 0.0297 }, eyeR: { x: 0.592, y: 0.47, rx: 0.0237, ry: 0.0297 }, mouth: { x: 0.501, y: 0.614, w: 0.092, h: 0.009 }, skin: "#fed6b3", lip: "#d48c6c" },
	patient_middle_male: { eyeL: { x: 0.402, y: 0.459, rx: 0.0212, ry: 0.0273 }, eyeR: { x: 0.583, y: 0.459, rx: 0.0212, ry: 0.0273 }, mouth: { x: 0.489, y: 0.615, w: 0.109, h: 0.012 }, skin: "#fed6b3", lip: "#da8e6d" },
	patient_youth_female: { eyeL: { x: 0.401, y: 0.465, rx: 0.0226, ry: 0.0301 }, eyeR: { x: 0.586, y: 0.465, rx: 0.0241, ry: 0.0301 }, mouth: { x: 0.491, y: 0.608, w: 0.099, h: 0.009 }, skin: "#fed6b3", lip: "#df916d" },
	patient_youth_male: { eyeL: { x: 0.411, y: 0.453, rx: 0.0211, ry: 0.0271 }, eyeR: { x: 0.589, y: 0.453, rx: 0.0211, ry: 0.0271 }, mouth: { x: 0.498, y: 0.605, w: 0.096, h: 0.009 }, skin: "#fed6b3", lip: "#d58663" },
};

/** 从图片 URL 找回 rig：资源文件名是 `<stem>-<hash>.png`（打包）或 `<stem>.png`（病历直传）。 */
export function rigFor(src: string): PortraitRig | null {
	const file = (src.split("?")[0].split("/").pop() ?? "").replace(/\.png$/i, "");
	const stem = file.replace(/-[A-Za-z0-9_-]{8}$/, "");
	return RIGS[stem] ?? null;
}
