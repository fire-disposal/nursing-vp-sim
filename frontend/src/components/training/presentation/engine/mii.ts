/**
 * 程序化角色绘制 — 全部由 canvas 路径画出来，不加载任何图片。
 *
 * 风格是 Mii / 动森那一路：大头、圆脸、两点眼、极简嘴；靠比例、发型与配色区分年龄性别，
 * 靠表情参数区分情绪。动画只有三种：眨眼、呼吸/微转、口型（音频包络驱动）。
 *
 * 反恐怖谷的几条硬规则（改之前先读）：
 *   - 只用平面色块 + 极少描边，不做渐变皮肤、不做写实阴影；
 *   - 五官全部是整块几何形状（椭圆/圆角线），不做细节纹理（睫毛、毛孔、牙齿高光一类）；
 *   - 嘴只有「一条弧」和「一个开合的椭圆」两种形态，不做舌头/牙齿的层次；
 *   - 头发是一整片剪影贴在头上，不做发丝。
 *
 * 坐标系：画布先缩放到 0..1 的方框，所有数字都是画面比例，线宽也按比例给。
 */

import type { CharacterSpec, Expression } from "./character";
import type { MouthShape } from "./motion";

export interface MiiFrame {
	/** 闭眼程度 0..1 */
	blink: number;
	/** 当前该画哪张嘴（离散帧，硬切） */
	mouthShape: MouthShape;
	/** 口宽倍率 0.92..1.08 */
	mouthWidth: number;
	/** 口高倍率，由情绪动效参数决定。 */
	mouthHeight: number;
	/** 呼吸 -1..1 */
	breath: number;
	/** 头部摆动 -1..1 */
	sway: number;
	/** 独立注视偏移 -1..1，不随头部同步摆动。 */
	gazeX: number;
	gazeY: number;
	/** 说话点头 -1..1 */
	nod: number;
	/** 说话时额外出力抬眉 0..1 */
	emphasize: number;
}

const MOUTH_LINE = "#8d5a52";
const MOUTH_OPEN = "#7f423c";

/** 身体：脖子 → 衣服。脖子先画，衣服盖住它的下沿。 */
function drawNeckAndBody(ctx: CanvasRenderingContext2D, spec: CharacterSpec, frame: MiiFrame) {
	const { cy, ry } = spec.head;
	const neckTop = cy + ry * 0.9;
	const shoulder = spec.body.top - frame.breath * 0.002;
	const half = spec.body.w / 2;

	// 脖子略向下收窄，下沿被领口盖住，避免矩形接头。
	ctx.beginPath();
	ctx.moveTo(0.5 - spec.neck.w / 2, neckTop);
	ctx.lineTo(0.5 + spec.neck.w / 2, neckTop);
	ctx.lineTo(0.5 + spec.neck.w * 0.44, shoulder + 0.05);
	ctx.lineTo(0.5 - spec.neck.w * 0.44, shoulder + 0.05);
	ctx.closePath();
	ctx.fillStyle = spec.skin;
	ctx.fill();

	// 身体：圆肩梯形
	ctx.beginPath();
	ctx.moveTo(0.5 - spec.neck.w * 0.62, shoulder - 0.015);
	ctx.quadraticCurveTo(0.5 - half * 0.8, shoulder + 0.055, 0.5 - half, 1.05);
	ctx.lineTo(0.5 + half, 1.05);
	ctx.quadraticCurveTo(0.5 + half * 0.8, shoulder + 0.055, 0.5 + spec.neck.w * 0.62, shoulder - 0.015);
	ctx.closePath();
	ctx.fillStyle = spec.cloth;
	ctx.fill();

	// 领口：沿着肩线的浅色领带
	ctx.beginPath();
	ctx.moveTo(0.5 - spec.neck.w * 0.72, shoulder + 0.004);
	ctx.quadraticCurveTo(0.5, shoulder + 0.085, 0.5 + spec.neck.w * 0.72, shoulder + 0.004);
	ctx.strokeStyle = spec.collar;
	ctx.lineWidth = 0.026;
	ctx.lineCap = "round";
	ctx.stroke();
}

/** 下巴投影跟头走，避免头部微动时阴影在脖子上滑动。 */
function drawChinShadow(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	const neckTop = spec.head.cy + spec.head.ry * 0.9;
	ctx.beginPath();
	ctx.ellipse(0.5, neckTop + 0.006, spec.neck.w * 0.62, 0.022, 0, 0, Math.PI);
	ctx.fillStyle = "rgba(214, 164, 126, 0.5)";
	ctx.fill();
}

/**
 * 头发（头后面的一层）：一圈比头略大的「发型体积」，头会盖住中间，只露出上缘与两侧。
 * 长发/波波头再额外在耳侧垂两束。全部画在头之前，所以不会挡住脸。
 */
function drawHairBack(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	const { cy, rx, ry } = spec.head;
	const long = spec.hairStyle === "long" || spec.hairStyle === "bob";

	if (long) {
		// 后层只负责头后的体积；肩前发束在 drawHairFront 中画到衣服之上。
		const bottom = spec.hairStyle === "long" ? cy + ry * 1.85 : cy + ry * 1.15;
		ctx.beginPath();
		ctx.moveTo(0.5 - rx * 1.02, cy - ry * 0.15);
		ctx.bezierCurveTo(0.5 - rx * 1.1, cy - ry * 0.95, 0.5 + rx * 1.1, cy - ry * 0.95, 0.5 + rx * 1.02, cy - ry * 0.15);
		ctx.bezierCurveTo(0.5 + rx * 1.02, cy + ry * 0.55, 0.5 + rx * 0.92, bottom - ry * 0.25, 0.5 + rx * 0.66, bottom);
		ctx.lineTo(0.5 - rx * 0.66, bottom);
		ctx.bezierCurveTo(0.5 - rx * 0.92, bottom - ry * 0.25, 0.5 - rx * 1.02, cy + ry * 0.55, 0.5 - rx * 1.02, cy - ry * 0.15);
		ctx.closePath();
		ctx.fillStyle = spec.hairShade;
		ctx.fill();
		return;
	}

	// 短发的头顶不是标准半椭圆：发缝侧略高，另一侧收低。
	const volume = spec.wrinkles > 0.5 ? 0.99 : 1.05;
	const partX = 0.5 + spec.hairPart * rx;
	ctx.beginPath();
	ctx.moveTo(0.5 - rx * volume, cy + ry * 0.05);
	ctx.bezierCurveTo(0.5 - rx * 1.08, cy - ry * 0.55, 0.5 - rx * 0.55, cy - ry * 1.04, partX, cy - ry * 1.06);
	ctx.bezierCurveTo(0.5 + rx * 0.65, cy - ry * 1.02, 0.5 + rx * 1.08, cy - ry * 0.52, 0.5 + rx * volume, cy + ry * 0.05);
	ctx.closePath();
	ctx.fillStyle = spec.hair;
	ctx.fill();
}

function drawEars(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	const { y, dx, rx, ry } = spec.ears;
	for (const sign of [-1, 1]) {
		const cx = 0.5 + sign * dx;
		// 上端接颞侧、下端收成耳垂；内侧半部随后由脸盖住。
		ctx.beginPath();
		ctx.moveTo(cx - sign * rx * 0.55, y - ry * 0.78);
		ctx.bezierCurveTo(cx + sign * rx * 0.45, y - ry * 1.08, cx + sign * rx, y - ry * 0.58, cx + sign * rx * 0.9, y);
		ctx.bezierCurveTo(cx + sign * rx * 0.82, y + ry * 0.58, cx + sign * rx * 0.34, y + ry, cx - sign * rx * 0.12, y + ry * 0.82);
		ctx.bezierCurveTo(cx - sign * rx * 0.58, y + ry * 0.6, cx - sign * rx * 0.62, y - ry * 0.28, cx - sign * rx * 0.55, y - ry * 0.78);
		ctx.closePath();
		ctx.fillStyle = spec.skin;
		ctx.fill();

		ctx.beginPath();
		ctx.moveTo(cx + sign * rx * 0.28, y - ry * 0.42);
		ctx.quadraticCurveTo(cx + sign * rx * 0.65, y - ry * 0.08, cx + sign * rx * 0.2, y + ry * 0.36);
		ctx.strokeStyle = spec.skinShade;
		ctx.globalAlpha = 0.62;
		ctx.lineWidth = 0.006;
		ctx.lineCap = "round";
		ctx.stroke();
		ctx.globalAlpha = 1;
	}
}

/** 头部唯一轮廓：脸部填充与前发裁剪共用，避免发际线沿另一套几何漂移。 */
function traceHead(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	const { cy, rx, ry, cheek, jaw, chin } = spec.head;
	const cx = 0.5;
	ctx.beginPath();
	ctx.moveTo(cx, cy - ry);
	ctx.bezierCurveTo(cx + rx * 0.58, cy - ry * 1.02, cx + rx * 0.96, cy - ry * 0.62, cx + rx, cy - ry * 0.18);
	ctx.bezierCurveTo(cx + rx * 1.02, cy + ry * 0.22, cx + rx * cheek, cy + ry * 0.52, cx + rx * jaw, cy + ry * 0.76);
	ctx.bezierCurveTo(cx + rx * jaw * 0.72, cy + ry * 0.94, cx + rx * 0.28, cy + ry * chin, cx, cy + ry * chin);
	ctx.bezierCurveTo(cx - rx * 0.28, cy + ry * chin, cx - rx * jaw * 0.72, cy + ry * 0.94, cx - rx * jaw, cy + ry * 0.76);
	ctx.bezierCurveTo(cx - rx * cheek, cy + ry * 0.52, cx - rx * 1.02, cy + ry * 0.22, cx - rx, cy - ry * 0.18);
	ctx.bezierCurveTo(cx - rx * 0.96, cy - ry * 0.62, cx - rx * 0.58, cy - ry * 1.02, cx, cy - ry);
	ctx.closePath();
}

function drawHeadShape(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	traceHead(ctx, spec);
	ctx.fillStyle = spec.skin;
	ctx.fill();
}

/**
 * 前发：裁在头部椭圆里的一大片，下沿是一条平滑的发际线弧（两侧略低、中间略高），
 * 没有折角也没有缺口。女性再沿脸侧加两条收尖的发帘，把耳朵盖住但不挤脸颊。
 */
function drawHairFront(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	const { cy, rx, ry } = spec.head;
	const longish = spec.hairStyle === "long" || spec.hairStyle === "bob";
	const thinning = spec.wrinkles > 0.5 && spec.hairStyle === "short";
	const hairline = cy - ry * (thinning ? 0.72 : longish ? 0.5 : 0.54);
	const partX = 0.5 + spec.hairPart * rx;
	ctx.save();
	traceHead(ctx, spec);
	ctx.clip();
	ctx.beginPath();
	ctx.moveTo(0.5 - rx, 0);
	ctx.lineTo(0.5 + rx, 0);
	ctx.lineTo(0.5 + rx, hairline + ry * 0.18);
	// 偏分的大片刘海：两侧高度不同，但不画单根发丝。
	ctx.bezierCurveTo(0.5 + rx * 0.58, hairline + ry * 0.02, 0.5 + rx * 0.28, hairline - ry * 0.08, partX, hairline - ry * 0.12);
	ctx.bezierCurveTo(0.5 - rx * 0.18, hairline - ry * 0.02, 0.5 - rx * 0.58, hairline + ry * 0.1, 0.5 - rx, hairline + ry * 0.22);
	ctx.closePath();
	ctx.fillStyle = spec.hair;
	ctx.fill();
	ctx.restore();

	if (!longish) return;

	// 肩前发束最后落在衣服上；左右长度略不同，末端收尖。
	for (const sign of [-1, 1]) {
		const length = spec.hairStyle === "long" ? 1.62 + (sign > 0 ? 0.04 : -0.02) : 0.96;
		const tip = cy + ry * length;
		ctx.beginPath();
		ctx.moveTo(0.5 + sign * rx * 0.78, hairline - ry * 0.04);
		ctx.bezierCurveTo(0.5 + sign * rx * 1.08, cy - ry * 0.2, 0.5 + sign * rx * 1.08, tip - ry * 0.35, 0.5 + sign * rx * 0.88, tip);
		ctx.quadraticCurveTo(0.5 + sign * rx * 0.8, tip + ry * 0.04, 0.5 + sign * rx * 0.76, tip - ry * 0.14);
		ctx.bezierCurveTo(0.5 + sign * rx * 0.9, cy + ry * 0.22, 0.5 + sign * rx * 0.9, cy - ry * 0.2, 0.5 + sign * rx * 0.6, hairline - ry * 0.02);
		ctx.closePath();
		ctx.fillStyle = spec.hair;
		ctx.fill();
	}
}

function drawBrows(ctx: CanvasRenderingContext2D, spec: CharacterSpec, expr: Expression, frame: MiiFrame) {
	const raise = (expr.browRaise + frame.emphasize * 0.35) * 0.012;
	const y = spec.brows.y - raise;
	const w = spec.brows.w / 2;
	for (const sign of [-1, 1]) {
		const cx = 0.5 + sign * spec.brows.dx;
		// 眉头压低/抬高：ang > 0 时内侧（靠中线那一端）低
		const inner = y + (sign > 0 ? expr.browAngle : -expr.browAngle) * 0.0012;
		const outer = y - (sign > 0 ? expr.browAngle : -expr.browAngle) * 0.0012;
		ctx.beginPath();
		ctx.moveTo(cx - sign * w, outer);
		ctx.quadraticCurveTo(cx, y - 0.011, cx + sign * w, inner);
		ctx.strokeStyle = spec.hairShade;
		ctx.lineWidth = spec.brows.thick;
		ctx.lineCap = "round";
		ctx.stroke();
	}
}

/**
 * 眼睛共用同一套轮廓：眼白/眼珠的填充、裁剪和眼皮遮罩不再各算一套。
 * dot/glint 是圆润深色眼；lash/crescent 是带眼白的杏仁眼。
 */
function traceEye(
	ctx: CanvasRenderingContext2D,
	style: CharacterSpec["eyeStyle"],
	ex: number,
	y: number,
	rx: number,
	h: number,
) {
	ctx.beginPath();
	if (style === "dot" || style === "glint") {
		ctx.ellipse(ex, y, rx * 0.94, h, 0, 0, Math.PI * 2);
		return;
	}
	// 控制点放在 2h，曲线实际顶点才在 -h；下缘实际为 +0.75h。
	ctx.moveTo(ex - rx, y);
	ctx.quadraticCurveTo(ex, y - h * 2, ex + rx, y);
	ctx.quadraticCurveTo(ex, y + h * 1.5, ex - rx, y);
	ctx.closePath();
}

function drawEyeStyle(
	ctx: CanvasRenderingContext2D,
	style: CharacterSpec["eyeStyle"],
	ex: number,
	y: number,
	rx: number,
	h: number,
	lookX: number,
	lookY: number,
) {
	if (style === "dot" || style === "glint") {
		// 无眼白时让整个深色眼形微移，而不是只移动高光。
		const darkX = ex + lookX;
		const darkY = y + lookY;
		traceEye(ctx, style, darkX, darkY, rx, h);
		ctx.fillStyle = "#2e2622";
		ctx.fill();
		if (style === "glint") {
			ctx.save();
			traceEye(ctx, style, darkX, darkY, rx, h);
			ctx.clip();
			ctx.beginPath();
			ctx.ellipse(darkX - rx * 0.26, darkY - h * 0.34, rx * 0.22, rx * 0.17, -0.4, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(255,255,255,0.95)";
			ctx.fill();
			ctx.restore();
		}
		return;
	}

	traceEye(ctx, style, ex, y, rx, h);
	ctx.fillStyle = "#fffdf9";
	ctx.fill();
	ctx.save();
	traceEye(ctx, style, ex, y, rx, h);
	ctx.clip();
	ctx.beginPath();
	ctx.ellipse(ex + lookX, y + lookY - h * 0.08, rx * 0.8, h * 0.9, 0, 0, Math.PI * 2);
	ctx.fillStyle = "#2e2622";
	ctx.fill();
	if (style === "crescent") {
		ctx.beginPath();
		ctx.ellipse(ex + lookX, y + lookY + h * 0.62, rx * 0.5, h * 0.34, 0, 0, Math.PI);
		ctx.fillStyle = "rgba(255,255,255,0.5)";
		ctx.fill();
	} else {
		ctx.beginPath();
		ctx.ellipse(ex + lookX - rx * 0.22, y + lookY - h * 0.34, rx * 0.21, rx * 0.16, -0.4, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(255,255,255,0.92)";
		ctx.fill();
	}
	ctx.restore();
}

/** 上眼睑从真实上缘压下；常态眼线贴着杏仁眼上缘，不再悬在眼睛上方。 */
function drawLids(ctx: CanvasRenderingContext2D, spec: CharacterSpec, expr: Expression, frame: MiiFrame) {
	const { y, dx, rx, ry } = spec.eyes;
	const h = ry * expr.eyeOpen;
	const blink = Math.min(1, Math.max(0, frame.blink));
	for (const sign of [-1, 1]) {
		const ex = 0.5 + sign * dx;
		const top = y - h;
		const lidY = top + h * 1.28 * blink;
		ctx.save();
		traceEye(ctx, spec.eyeStyle, ex, y, rx, h);
		ctx.clip();
		if (lidY > top) {
			ctx.fillStyle = spec.skin;
			ctx.fillRect(ex - rx * 1.2, top - h * 0.05, rx * 2.4, lidY - top + h * 0.05);
		}
		ctx.restore();

		if ((spec.eyeStyle === "dot" || spec.eyeStyle === "glint") && blink < 0.02) continue;
		const closedness = Math.min(1, Math.max(0, blink * 1.6));
		const cornerY = y + (lidY - y) * blink;
		ctx.beginPath();
		ctx.moveTo(ex - rx, cornerY);
		if (closedness < 0.02 && spec.eyeStyle !== "dot" && spec.eyeStyle !== "glint") {
			ctx.quadraticCurveTo(ex, y - h * 2, ex + rx, cornerY);
		} else {
			ctx.quadraticCurveTo(ex, lidY + h * 0.55 * closedness, ex + rx, cornerY);
		}
		ctx.strokeStyle = blink > 0.5 ? "rgba(58,43,38,0.9)" : "rgba(58,43,38,0.62)";
		ctx.lineWidth = 0.007;
		ctx.lineCap = "round";
		ctx.stroke();
	}
}

function drawEyes(ctx: CanvasRenderingContext2D, spec: CharacterSpec, expr: Expression, frame: MiiFrame) {
	const { y, dx, rx } = spec.eyes;
	const h = spec.eyes.ry * expr.eyeOpen;
	const lookX = frame.gazeX * 0.004;
	const lookY = frame.gazeY * 0.002;
	if (frame.blink < 0.985) {
		for (const sign of [-1, 1]) {
			drawEyeStyle(ctx, spec.eyeStyle, 0.5 + sign * dx, y, rx, h, lookX, lookY);
		}
	}
	drawLids(ctx, spec, expr, frame);
}

function drawNose(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	const y = spec.nose.y;
	const w = spec.nose.w;
	ctx.beginPath();
	ctx.moveTo(0.5 - w / 2, y);
	ctx.quadraticCurveTo(0.5, y + w * 0.7, 0.5 + w / 2, y);
	ctx.strokeStyle = "rgba(196, 143, 108, 0.55)";
	ctx.lineWidth = 0.009;
	ctx.lineCap = "round";
	ctx.stroke();
}

function drawCheeks(ctx: CanvasRenderingContext2D, spec: CharacterSpec, expr: Expression) {
	const y = spec.eyes.y + 0.072;
	for (const sign of [-1, 1]) {
		ctx.beginPath();
		ctx.ellipse(0.5 + sign * (spec.eyes.dx + 0.052), y, 0.042, 0.024, 0, 0, Math.PI * 2);
		ctx.fillStyle = spec.blush;
		ctx.globalAlpha = expr.blush * 0.45;
		ctx.fill();
		ctx.globalAlpha = 1;
	}
}

/**
 * 嘴：四个手绘嘴型硬切（closed / small / mid / wide）。
 *
 * 形态共用一条「上沿几乎平、下沿是圆弧」的轮廓，只有宽高不同——这样切帧时嘴的位置不跳，
 * 观感是「嘴在动」而不是「换了张嘴」。闭口时退化成一条随情绪的弧。
 */
function drawMouth(ctx: CanvasRenderingContext2D, spec: CharacterSpec, expr: Expression, frame: MiiFrame) {
	const cy = spec.mouth.y + 0.006;
	const half = (spec.mouth.w * expr.mouthWidth * frame.mouthWidth) / 2;

	if (frame.mouthShape === "closed") {
		const cornerY = cy - expr.smile * 0.016;
		ctx.beginPath();
		ctx.moveTo(0.5 - half, cornerY);
		ctx.quadraticCurveTo(0.5, cy + 0.012 + expr.smile * 0.006, 0.5 + half, cornerY);
		ctx.strokeStyle = MOUTH_LINE;
		ctx.lineWidth = 0.012;
		ctx.lineCap = "round";
		ctx.stroke();
		return;
	}

	// 说话时的嘴一定是「宽 > 高」，高一点的圆口会读成惊讶
	const scale = frame.mouthShape === "small" ? { w: 0.6, h: 0.014 } : frame.mouthShape === "mid" ? { w: 0.85, h: 0.024 } : { w: 1.05, h: 0.035 };
	const w = half * scale.w;
	const h = scale.h * frame.mouthHeight;
	ctx.beginPath();
	ctx.moveTo(0.5 - w, cy);
	// 上沿：略向上拱一点，避免一条死平线
	ctx.quadraticCurveTo(0.5, cy - h * 0.16, 0.5 + w, cy);
	// 下沿：圆弧
	ctx.quadraticCurveTo(0.5, cy + h * 1.1, 0.5 - w, cy);
	ctx.closePath();
	ctx.fillStyle = MOUTH_OPEN;
	ctx.fill();
}

function drawWrinkles(ctx: CanvasRenderingContext2D, spec: CharacterSpec) {
	if (spec.wrinkles <= 0.01) return;
	const { cy, ry } = spec.head;
	ctx.strokeStyle = `rgba(190, 140, 108, ${0.22 * spec.wrinkles})`;
	ctx.lineWidth = 0.007;
	ctx.lineCap = "round";
	// 额纹：两道很短的弧
	for (const k of [-0.62, -0.7]) {
		ctx.beginPath();
		ctx.moveTo(0.5 - 0.06, cy + ry * k);
		ctx.quadraticCurveTo(0.5, cy + ry * (k - 0.05), 0.5 + 0.06, cy + ry * k);
		ctx.stroke();
	}
	// 法令纹：从鼻翼斜向嘴角
	for (const sign of [-1, 1]) {
		ctx.beginPath();
		ctx.moveTo(0.5 + sign * 0.055, spec.nose.y + 0.03);
		ctx.quadraticCurveTo(0.5 + sign * 0.085, spec.mouth.y - 0.015, 0.5 + sign * 0.065, spec.mouth.y + 0.012);
		ctx.stroke();
	}
}

/** 画一帧。调用方保证画布已是物理像素。 */
export function drawMii(
	ctx: CanvasRenderingContext2D,
	spec: CharacterSpec,
	expr: Expression,
	frame: MiiFrame,
) {
	const W = ctx.canvas.width;
	const H = ctx.canvas.height;
	ctx.clearRect(0, 0, W, H);
	ctx.save();
	ctx.scale(W, H);

	// 背景：极浅的一层底色，让白色主体不显得飘
	const bg = ctx.createLinearGradient(0, 0, 0, 1);
	bg.addColorStop(0, "#f4f8fc");
	bg.addColorStop(1, "#e6eef8");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, 1, 1);

	drawHairBack(ctx, spec);
	drawNeckAndBody(ctx, spec, frame);

	// 点头以绕颈俯仰为主、微小位移为辅；呼吸保留较慢的整体起伏。
	const pivot = { x: 0.5, y: spec.head.cy + spec.head.ry * 0.9 };
	ctx.save();
	ctx.translate(pivot.x, pivot.y + frame.breath * 0.0035 + frame.nod * 0.0012);
	ctx.rotate(frame.sway * 0.03 + frame.nod * 0.018);
	ctx.translate(-pivot.x, -pivot.y);
	drawChinShadow(ctx, spec);
	drawEars(ctx, spec);
	drawHeadShape(ctx, spec);
	drawWrinkles(ctx, spec);
	drawBrows(ctx, spec, expr, frame);
	drawEyes(ctx, spec, expr, frame);
	drawNose(ctx, spec);
	drawCheeks(ctx, spec, expr);
	drawMouth(ctx, spec, expr, frame);
	drawHairFront(ctx, spec);
	ctx.restore();

	ctx.restore();
}
