/**
 * 绘制引擎 — 把一张平面立绘按 rig 拆成可动的部位，逐帧重画到 canvas。
 *
 * 关键取舍（对比 M1 的「整图平移/旋转」）：
 *   1. **位移场**：主体按 18×18 网格切片重画，每片按所在位置平移（头顶摆得最多、下巴以下不动、
 *      下颌以唇线为支点下拉）。切片只平移不旋转，源矩形与目标矩形同步外扩 4 px，
 *      所以既不会露缝，也不会因为重叠过多在条纹衣服上出现重影；
 *   2. **背景盘**：抠过图时先合成「白底 + 浅蓝圆盘」再画主体，头动时背景不动；不垫底图，
 *      因为静止主体和位移后的主体会重叠出重影（头发边、条纹衣服最明显）；
 *   3. **局部重绘**：扁平画风的嘴先擦掉原唇线、再沿原图的微笑弧重画（张口时补口腔暗区与牙），
 *      不是「纵向拉伸原图」（那会拉出双重嘴唇）；写实照片擦不掉纹理，只做唇缝内阴影 + 下颌位移；
 *   4. **眼皮**：扁平画风用眼旁实测肤色盖住眼睛 + 睫毛线；照片把眼睛上方一条皮肤向下拉以保留纹理。
 *
 * 坐标系：rig 归一化；画布内换算成像素，叠加层用同一条位移场定位，才能跟着脸一起动。
 */

import { FLAT_DISC, type Layers } from "./layers";
import type { MotionProfile } from "./motion";
import type { PortraitRig } from "./rig";

export interface FrameState {
	/** 头部左右摆 -1..1 */
	sway: number;
	/** 说话点头 -1..1 */
	nod: number;
	/** 呼吸相位 -1..1 */
	breath: number;
	/** 闭眼程度 0..1 */
	blink: number;
	/** 下颌下移 0..1（乘 profile.jawOpen） */
	jaw: number;
	/** 口型开合 0..1 */
	mouth: number;
}

const GRID = 18;
/**
 * 重叠是必要的（否则相邻切片会露缝），但重叠越多，同一处内容会被画两次、错开 0.5~3 px，
 * 在条纹衣服上会变成重影。4 px 是两者之间的折中：缝被盖住，重影也看不出来。
 */
const OVERLAP = 4;

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 单调平滑阶跃（a>b 时反向） */
function smoothstep(a: number, b: number, x: number): number {
	const t = clamp01((x - a) / (b - a || 1e-6));
	return t * t * (3 - 2 * t);
}

/** 某点的位移（归一化单位；调用方乘画布宽高）。 */
export function fieldAt(x: number, y: number, s: FrameState, p: MotionProfile, rig: PortraitRig) {
	// 脖子是枢轴：头部的位移随「离枢轴的远近」线性增长，也就是绕颈部的旋转（不是整体平移）
	const chinY = rig.mouth.y + 0.11;
	const pivotY = chinY + 0.03;
	const headX = smoothstep(0.04, 0.2, x) * smoothstep(0.96, 0.8, x);
	const head = smoothstep(chinY, chinY - 0.14, y) * headX;
	const rot = s.sway * p.swayDeg * (Math.PI / 180);
	const tilt = Math.sin(rot) * (pivotY - y) * head;
	// 呼吸：只做竖向、且不随 x 变化——身体是一整块在起伏，条纹不会被剪错位
	const chest = smoothstep(chinY - 0.05, 0.99, y);
	// 下颌：以唇线为支点、下半张脸按比例往下拉；位移在唇线处恒为 0，嘴上不会有缝
	const mouthY = rig.mouth.y;
	const jawWindow = smoothstep(mouthY - 0.02, mouthY + 0.02, y) * (1 - smoothstep(chinY - 0.03, chinY + 0.01, y));
	const jawX = smoothstep(0.12, 0.3, x) * smoothstep(0.88, 0.7, x);
	const jawDrop = (y - mouthY) * s.jaw * 0.11 * jawWindow * jawX;
	// 画布上下边缘的位移必须收到 0：主体一动，边缘就会露出背景盘
	const edge = (1 - smoothstep(0.9, 1, y)) * smoothstep(0, 0.08, y);
	return {
		dx: tilt * edge,
		dy: (-s.breath * p.breathAmp * chest + jawDrop + s.nod * 0.006 * head) * edge,
	};
}

/** 背景盘（抠过图时合成；照片直接铺原图）+ 主体按位移场重画。 */
function drawWarped(ctx: CanvasRenderingContext2D, layers: Layers, s: FrameState, p: MotionProfile, rig: PortraitRig) {
	const W = ctx.canvas.width;
	const H = ctx.canvas.height;
	const src = layers.subject;
	const iw = src.width;
	const ih = src.height;

	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, W, H);
	ctx.beginPath();
	ctx.arc(W / 2, H / 2, FLAT_DISC.r * Math.min(W, H), 0, Math.PI * 2);
	ctx.fillStyle = FLAT_DISC.bg;
	ctx.fill();
	// 主体只能出现在圆盘里：否则肩膀会落到圆盘外的白角上
	ctx.save();
	ctx.clip();

	const tileW = W / GRID;
	const tileH = H / GRID;
	const srcW = iw / GRID;
	const srcH = ih / GRID;
	// 重叠要按同样比例加在源矩形上，否则每片就变成「放大叠加」，整张脸会糊成马赛克
	const srcPadX = (OVERLAP / W) * iw;
	const srcPadY = (OVERLAP / H) * ih;
	for (let gy = 0; gy < GRID; gy += 1) {
		for (let gx = 0; gx < GRID; gx += 1) {
			const cx = (gx + 0.5) / GRID;
			const cy = (gy + 0.5) / GRID;
			const d = fieldAt(cx, cy, s, p, rig);
			ctx.drawImage(
				src,
				gx * srcW - srcPadX,
				gy * srcH - srcPadY,
				srcW + srcPadX * 2,
				srcH + srcPadY * 2,
				gx * tileW + d.dx * W - OVERLAP,
				gy * tileH + d.dy * H - OVERLAP,
				tileW + OVERLAP * 2,
				tileH + OVERLAP * 2,
			);
		}
	}
	ctx.restore();
}

/** 给任意 css 颜色（#rrggbb 或 rgb()）加透明度。 */
function withAlpha(color: string, alpha: number): string {
	const m = color.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const [r, g, b] = m[1].split(",").map((v) => Number.parseFloat(v));
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	const h = color.replace("#", "");
	return `rgba(${Number.parseInt(h.slice(0, 2), 16)}, ${Number.parseInt(h.slice(2, 4), 16)}, ${Number.parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

/** 眼皮：用眼旁实测的肤色盖住眼睛（原图的眼睛是整块深色，盖住即闭眼），再补一条睫毛线。 */
function drawEyes(ctx: CanvasRenderingContext2D, layers: Layers, rig: PortraitRig, s: FrameState, p: MotionProfile) {
	if (s.blink <= 0.005) return;
	const W = ctx.canvas.width;
	const H = ctx.canvas.height;
	for (const [index, eye] of [rig.eyeL, rig.eyeR].entries()) {
		const d = fieldAt(eye.x, eye.y, s, p, rig);
		const ex = eye.x * W;
		const ey = eye.y * H;
		const rx = eye.rx * W;
		const ry = eye.ry * H;
		const closed = clamp01(s.blink);
		ctx.save();
		ctx.translate(d.dx * W, d.dy * H);
		ctx.beginPath();
		ctx.ellipse(ex, ey, rx * 1.06, ry * 1.06, 0, 0, Math.PI * 2);
		ctx.clip();
		const edge = ey - ry + 2 * ry * closed;
		const tone = index === 0 ? layers.samples.aboveEyeL : layers.samples.aboveEyeR;
		// 用眼睛旁边实测的肤色整块盖掉：颜色与脸一致，闭眼时只剩一条睫毛线（半透明会露出眼球）
		ctx.fillStyle = tone;
		ctx.fillRect(ex - rx * 1.2, ey - ry * 1.2, rx * 2.4, edge + ry * 0.2 - (ey - ry * 1.2));
		// 眼睑下的阴影：整块同色会像贴了两块胶布
		const shade = ctx.createLinearGradient(0, ey - ry, 0, edge);
		shade.addColorStop(0, "rgba(132, 88, 66, 0.14)");
		shade.addColorStop(0.5, "rgba(132, 88, 66, 0.04)");
		shade.addColorStop(1, "rgba(132, 88, 66, 0)");
		ctx.fillStyle = shade;
		ctx.fillRect(ex - rx * 1.2, ey - ry * 1.2, rx * 2.4, edge + ry * 0.2 - (ey - ry * 1.2));
		// 闭合边缘的暗线（睫毛/眼睑折痕）
		ctx.beginPath();
		ctx.moveTo(ex - rx, edge - ry * 0.05);
		ctx.quadraticCurveTo(ex, edge + ry * 0.35, ex + rx, edge - ry * 0.05);
		ctx.strokeStyle = `rgba(58, 38, 30, ${0.62 * closed})`;
		ctx.lineWidth = Math.max(1, ry * 0.22);
		ctx.stroke();
		ctx.restore();
	}
}

/** 擦掉原唇线后重画一张嘴（沿原图的微笑弧走，张口才补口腔）。 */
function drawFlatMouth(ctx: CanvasRenderingContext2D, layers: Layers, rig: PortraitRig, s: FrameState, p: MotionProfile) {
	const W = ctx.canvas.width;
	const H = ctx.canvas.height;
	const d = fieldAt(rig.mouth.x, rig.mouth.y, s, p, rig);
	ctx.save();
	ctx.translate(d.dx * W, d.dy * H);

	const cx = rig.mouth.x * W;
	const my = rig.mouth.y * H;
	const mw = rig.mouth.w * W;
	const mh = Math.max(rig.mouth.h * H, 2);

	// 1) 擦除：用嘴上下方真实肤色的竖向渐变盖掉原唇线（扁平画是纯色脸，这样接缝不可见）
	const ry = mw * 0.46;
	const skinGrad = ctx.createLinearGradient(0, my - ry, 0, my + ry);
	skinGrad.addColorStop(0, withAlpha(layers.samples.aboveMouth, 0));
	skinGrad.addColorStop(0.28, layers.samples.aboveMouth);
	skinGrad.addColorStop(0.72, layers.samples.belowMouth);
	skinGrad.addColorStop(1, withAlpha(layers.samples.belowMouth, 0));
	ctx.fillStyle = skinGrad;
	ctx.beginPath();
	ctx.ellipse(cx, my, mw * 0.62, ry, 0, 0, Math.PI * 2);
	ctx.fill();

	// 2) 重画：沿原图的「微笑弧」走——中段比两端低，只把下唇往下开，不做瞳孔式的圆嘴
	const open = clamp01(s.mouth);
	const halfW = mw * 0.42;
	const lipLine = my + mh * 0.5;
	const sag = mh * 2.2 + mw * 0.03;
	const openH = mw * 0.44 * open;

	// 上唇弧（闭口时就是这条线）+ 下唇弧（张口时向下让开）
	const arc = (drop: number) => {
		ctx.beginPath();
		ctx.moveTo(cx - halfW, lipLine);
		ctx.quadraticCurveTo(cx, lipLine + sag + drop * 0.35, cx + halfW, lipLine);
	};

	// 口腔：只在张到一定程度才出现，颜色取自原唇线的红棕，不用纯黑（原画风没有黑色块）
	const innerAlpha = smoothstep(0.08, 0.5, open);
	if (innerAlpha > 0.02) {
		ctx.beginPath();
		const lift = openH * 0.28;
		ctx.moveTo(cx - halfW, lipLine);
		ctx.quadraticCurveTo(cx, lipLine + sag * 0.85 - lift, cx + halfW, lipLine);
		ctx.quadraticCurveTo(cx, lipLine + sag * 1.15 + openH, cx - halfW, lipLine);
		ctx.closePath();
		ctx.fillStyle = `rgba(126, 60, 52, ${0.9 * innerAlpha})`;
		ctx.fill();
		ctx.save();
		ctx.clip();
		// 牙：一条贴着上唇的浅色带，窄
		ctx.fillStyle = `rgba(248, 240, 232, ${0.55 * innerAlpha})`;
		ctx.beginPath();
		ctx.ellipse(cx, lipLine + sag * 0.6, halfW * 0.6, Math.max(1, openH * 0.18), 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	// 唇线：主线跟着上唇弧，张口时描一圈轮廓
	if (open > 0.05) {
		const lift = openH * 0.28;
		ctx.beginPath();
		ctx.moveTo(cx - halfW, lipLine);
		ctx.quadraticCurveTo(cx, lipLine + sag * 0.85 - lift, cx + halfW, lipLine);
		ctx.quadraticCurveTo(cx, lipLine + sag * 1.15 + openH, cx - halfW, lipLine);
		ctx.closePath();
		ctx.strokeStyle = withAlpha(rig.lip, 0.7);
		ctx.lineWidth = Math.max(1, mh * 0.9);
		ctx.stroke();
	} else {
		arc(0);
		ctx.strokeStyle = rig.lip;
		ctx.lineWidth = Math.max(1, mh * 1.1);
		ctx.lineCap = "round";
		ctx.stroke();
	}
	ctx.restore();
}

/** 画一帧。调用方保证 canvas 尺寸已是物理像素、img 已解码。 */
export function renderFrame(
	ctx: CanvasRenderingContext2D,
	layers: Layers,
	rig: PortraitRig,
	s: FrameState,
	p: MotionProfile,
) {
	const W = ctx.canvas.width;
	const H = ctx.canvas.height;
	ctx.clearRect(0, 0, W, H);
	drawWarped(ctx, layers, s, p, rig);
	drawFlatMouth(ctx, layers, rig, s, p);
	drawEyes(ctx, layers, rig, s, p);
}
