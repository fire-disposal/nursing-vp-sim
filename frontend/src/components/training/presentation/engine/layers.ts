/**
 * 分层：把立绘拆成「背景盘」与「主体」两张位图，引擎才有东西可动。
 *
 * 扁平插画是规则版式：主体画在一个居中、半径约为半幅宽的浅蓝圆盘上，圆盘外是白底。
 * 于是背景可以合成（白底 + 圆盘），主体用色差抠出来——这样头动时背景不动，
 * 不会出现「整幅画在平移」或者「头发拖着背景一起走」。
 *
 * 只有扁平插画进引擎（写实照片不做，见 rig.ts 头注释），所以这里不需要「不抠图」的分支。
 */

import type { PortraitRig } from "./rig";

/** 扁平插画的圆盘规格（10 张同一版式，实测差异 < 0.5%）。 */
export const FLAT_DISC = { r: 0.497, bg: "#e5f2fc" } as const;

export interface Layers {
	/** 主体：圆盘外与底色为透明，只有人物本身。 */
	subject: HTMLCanvasElement;
	/** 关键点周围的真实底色（擦嘴、画眼皮要用图上原本的肤色，而不是一个全局中值）。 */
	samples: {
		aboveMouth: string;
		belowMouth: string;
		aboveEyeL: string;
		aboveEyeR: string;
	};
}

const cache = new Map<string, Layers>();

function emptySamples() {
	return { aboveMouth: "#ffffff", belowMouth: "#ffffff", aboveEyeL: "#ffffff", aboveEyeR: "#ffffff" };
}

function distance(r: number, g: number, b: number, tr: number, tg: number, tb: number): number {
	return Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb);
}

function average(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): string {
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	const cx = Math.round(x * w);
	const cy = Math.round(y * h);
	for (let dy = -1; dy <= 1; dy += 1) {
		for (let dx = -1; dx <= 1; dx += 1) {
			const px = cx + dx;
			const py = cy + dy;
			if (px < 0 || py < 0 || px >= w || py >= h) continue;
			const i = (py * w + px) * 4;
			r += data[i];
			g += data[i + 1];
			b += data[i + 2];
			n += 1;
		}
	}
	if (n === 0) return "#ffffff";
	return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
}

function buildSubject(img: HTMLImageElement, rig: PortraitRig): Layers {
	// 立绘原图只有 330~720 px，放大到 2 倍再抠：边缘按两倍分辨率判透明度，发丝才不会出现锯齿
	const w = Math.min(1400, img.naturalWidth * 2);
	const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return { subject: canvas, samples: emptySamples() };
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, 0, 0, w, h);

	const raw = ctx.getImageData(0, 0, w, h);
	const samples = {
		aboveMouth: average(raw.data, w, h, rig.mouth.x, rig.mouth.y - 0.045),
		belowMouth: average(raw.data, w, h, rig.mouth.x, rig.mouth.y + 0.035),
		// 取「眼睛外侧眼罩旁的皮肤」，不是眉毛/额头（那里更亮，盖下来会像贴了两块白）
		aboveEyeL: average(raw.data, w, h, rig.eyeL.x - rig.eyeL.rx * 2.1, rig.eyeL.y),
		aboveEyeR: average(raw.data, w, h, rig.eyeR.x + rig.eyeR.rx * 2.1, rig.eyeR.y),
	};
	const px = raw.data;
	const discR = FLAT_DISC.r * Math.min(w, h);
	const cx = w / 2;
	const cy = h / 2;
	const br = Number.parseInt(FLAT_DISC.bg.slice(1, 3), 16);
	const bg = Number.parseInt(FLAT_DISC.bg.slice(3, 5), 16);
	const bb = Number.parseInt(FLAT_DISC.bg.slice(5, 7), 16);
	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const i = (y * w + x) * 4;
			const dx = x - cx;
			const dy = y - cy;
			const outside = dx * dx + dy * dy > discR * discR;
			const d = distance(px[i], px[i + 1], px[i + 2], br, bg, bb);
			// 10..18 之间线性羽化，避免硬边
			// 羽化带宽一些：半透明像素叠在同样颜色的背景盘上，正好还原原图抗锯齿的边缘
			const keep = Math.max(0, Math.min(1, (d - 6) / 44));
			px[i + 3] = Math.round(255 * keep) * (outside ? 0 : 1);
		}
	}
	ctx.putImageData(raw, 0, 0);
	return { subject: canvas, samples };
}

/** 按图片地址缓存（同一张图只抠一次）。 */
export function layersFor(img: HTMLImageElement, rig: PortraitRig, src: string): Layers {
	const hit = cache.get(src);
	if (hit) return hit;
	const built = buildSubject(img, rig);
	cache.set(src, built);
	return built;
}
