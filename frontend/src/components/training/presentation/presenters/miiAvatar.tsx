import { useEffect, useRef } from "react";
import { characterSpec, expressionFor } from "../engine/character";
import { drawMii, type MiiFrame } from "../engine/mii";
import {
	approach,
	blinkAt,
	breathAt,
	gazeXAt,
	gazeYAt,
	mouthFrameAt,
	nodAt,
	profileFor,
	swayAt,
} from "../engine/motion";
import type {
	EmotionSnapshot,
	MiiAvatarPayload,
	PatientIdentity,
	PatientPresenter,
	PresentationContext,
} from "../types";

/**
 * mii — 全程序化绘制的患者形象（M3 实验）。不加载任何图片：身份 → 配色与比例，
 * 情绪 → 表情参数，时间 + 音频包络 → 眨眼/呼吸/口型。绘制见 `engine/mii.ts`。
 *
 * 仍未进生产链（`PRESENTATION_CHAIN` 还是 realistic → static），只在 `/lab` 陈列。
 */

/** 只依赖身份，保证刷新与重渲染后仍是同一个动作相位。 */
function identitySeed(patient: PatientIdentity | null): number {
	const key = `${patient?.name ?? ""}|${patient?.age ?? ""}|${patient?.gender ?? ""}`;
	let hash = 23;
	for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
	return hash % 10007;
}

/** 纯函数：身份 + 情绪 → 可渲染负载（表情与动效参数在 build 里定死）。 */
export function buildMiiAvatarPayload(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
): MiiAvatarPayload {
	return {
		kind: "mii",
		spec: characterSpec({ age: patient?.age ?? null, gender: patient?.gender ?? null }),
		expression: expressionFor(emotion.emotion),
		profile: profileFor(emotion.emotion),
		seed: identitySeed(patient),
	};
}
function MiiCanvas({ payload, ctx }: { payload: MiiAvatarPayload; ctx: PresentationContext }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const latest = useRef(ctx);
	latest.current = ctx;
	// 表情目标随 payload 更新，绘制时使用一份可插值的当前表情。
	const expressionTarget = useRef(payload.expression);
	expressionTarget.current = payload.expression;
	const expression = useRef({ ...payload.expression });
	const spec = useRef(payload.spec);
	spec.current = payload.spec;
	const profile = useRef(payload.profile);
	profile.current = payload.profile;
	const seed = useRef(payload.seed);
	seed.current = payload.seed;

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx2d = canvas?.getContext("2d");
		if (!canvas || !ctx2d) return;

		let raf = 0;
		let stopped = false;
		let env = 0;
		let last = performance.now();
		const start = last;

		const resizeCanvas = () => {
			const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
			const rect = canvas.getBoundingClientRect();
			const size = Math.max(1, Math.round(rect.width * dpr));
			if (canvas.width !== size || canvas.height !== size) {
				canvas.width = size;
				canvas.height = size;
			}
		};
		resizeCanvas();
		const observer = new ResizeObserver(resizeCanvas);
		observer.observe(canvas);

		const draw = (now: number) => {
			if (stopped) return;
			raf = requestAnimationFrame(draw);
			if (document.hidden) {
				last = now;
				return;
			}
			const dt = Math.min(0.06, Math.max(0.001, (now - last) / 1000));
			last = now;
			const c = latest.current;
			const t = (now - start) / 1000;
			env = approach(env, c.speaking ? Math.min(1, Math.max(0, c.envelope ?? 0)) : 0, dt, 0.05, 0.13);
			const mouth = mouthFrameAt(t, env, c.speaking === true);
			const motion = profile.current;
			const current = expression.current;
			const target = expressionTarget.current;
			current.browAngle = approach(current.browAngle, target.browAngle, dt, 0.09, 0.14);
			current.browRaise = approach(current.browRaise, target.browRaise, dt, 0.09, 0.14);
			current.eyeOpen = approach(current.eyeOpen, target.eyeOpen, dt, 0.09, 0.14);
			current.smile = approach(current.smile, target.smile, dt, 0.09, 0.14);
			current.blush = approach(current.blush, target.blush, dt, 0.09, 0.14);
			current.mouthWidth = approach(current.mouthWidth, target.mouthWidth, dt, 0.09, 0.14);
			const frame: MiiFrame = {
				blink: blinkAt(t, motion.blinkSeconds, seed.current),
				mouthShape: mouth.shape,
				mouthWidth: mouth.width,
				mouthHeight: motion.jawOpen / 0.019,
				breath: breathAt(t, motion.breathSeconds) * (motion.breathAmp / 0.009),
				sway: swayAt(t, seed.current) * (motion.swayDeg / 1.8),
				gazeX: gazeXAt(t, seed.current),
				gazeY: gazeYAt(t, seed.current),
				nod: nodAt(t, env, 0.8),
				emphasize: env * 0.6,
			};
			drawMii(ctx2d, spec.current, current, frame);
		};
		raf = requestAnimationFrame(draw);

		return () => {
			stopped = true;
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	}, []);

	return (
		<div
			data-mii-avatar
			data-speaking={ctx.speaking ? "true" : "false"}
			className={ctx.className}
			style={{
				width: ctx.fill ? "100%" : ctx.size,
				aspectRatio: "1 / 1",
				position: "relative",
				overflow: "hidden",
				borderRadius: ctx.rounded === "full" ? "999px" : "1rem",
				boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
			}}
		>
			<canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
		</div>
	);
}

export const miiAvatarPresenter: PatientPresenter = {
	kind: "mii",
	build(patient, emotion) {
		return buildMiiAvatarPayload(patient, emotion);
	},
	render(payload, ctx) {
		if (payload.kind !== "mii") return null;
		// 减弱动态：画一帧静止的图（不启动逐帧绘制）
		if (ctx.reducedMotion) return <MiiStill payload={payload} ctx={ctx} />;
		return <MiiCanvas payload={payload} ctx={ctx} />;
	},
};

/** 静止帧：同一套绘制，参数固定，用于「减少动效」与并排对照。 */
function MiiStill({ payload, ctx }: { payload: MiiAvatarPayload; ctx: PresentationContext }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx2d = canvas?.getContext("2d");
		if (!canvas || !ctx2d) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
		const size = Math.max(1, Math.round(canvas.getBoundingClientRect().width * dpr));
		canvas.width = size;
		canvas.height = size;
		drawMii(ctx2d, payload.spec, payload.expression, {
			blink: 0,
			mouthShape: "closed",
			mouthWidth: 1,
			mouthHeight: 1,
			breath: 0,
			sway: 0,
			gazeX: 0,
			gazeY: 0,
			nod: 0,
			emphasize: 0,
		});
	}, [payload.spec, payload.expression]);
	return (
		<div
			data-mii-avatar
			className={ctx.className}
			style={{
				width: ctx.fill ? "100%" : ctx.size,
				aspectRatio: "1 / 1",
				overflow: "hidden",
				borderRadius: ctx.rounded === "full" ? "999px" : "1rem",
				boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
			}}
		>
			<canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
		</div>
	);
}
