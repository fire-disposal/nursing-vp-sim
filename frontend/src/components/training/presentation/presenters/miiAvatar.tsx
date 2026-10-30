import { useEffect, useRef } from "react";
import { characterSpec, expressionFor } from "../engine/character";
import { drawMii, type MiiFrame } from "../engine/mii";
import {
	approach,
	blinkAt,
	breathAt,
	mouthShapeAt,
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
 * 仍未进生产链（`PRESENTATION_CHAIN` 还是 realistic → static），只在 `/presentation-lab` 陈列。
 */

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
	};
}

function MiiCanvas({ payload, ctx }: { payload: MiiAvatarPayload; ctx: PresentationContext }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const latest = useRef(ctx);
	latest.current = ctx;
	// 表情与动效参数是纯数据、跟着 payload 走；effect 只按绘制规格重建
	const expr = useRef(payload.expression);
	expr.current = payload.expression;
	const spec = useRef(payload.spec);
	spec.current = payload.spec;
	const profile = useRef(payload.profile);
	profile.current = payload.profile;

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx2d = canvas?.getContext("2d");
		if (!canvas || !ctx2d) return;

		let raf = 0;
		let stopped = false;
		let env = 0;
		let mouth = 0.04;
		let wide = 1;
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
			const shape = mouthShapeAt(t, env, c.speaking === true);
			mouth = approach(mouth, shape.open, dt, 0.045, 0.09);
			wide = approach(wide, shape.wide, dt, 0.05, 0.05);
			const frame: MiiFrame = {
				blink: blinkAt(t, profile.current.blinkSeconds),
				mouth,
				mouthWide: wide,
				breath: breathAt(t, profile.current.breathSeconds),
				sway: swayAt(t),
				nod: nodAt(t, env, 0.8),
				emphasize: env * 0.6,
			};
			drawMii(ctx2d, spec.current, expr.current, frame);
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
			mouth: 0.04,
			mouthWide: 1,
			breath: 0,
			sway: 0,
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
