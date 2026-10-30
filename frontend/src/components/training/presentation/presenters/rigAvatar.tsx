import { useEffect, useRef } from "react";
import { renderFrame } from "../engine/draw";
import { type Layers, layersFor } from "../engine/layers";
import {
	approach,
	blinkAt,
	breathAt,
	mouthTarget,
	nodAt,
	profileFor,
	swayAt,
} from "../engine/motion";
import { rigFor } from "../engine/rig";
import type {
	EmotionSnapshot,
	PatientIdentity,
	PatientPresenter,
	PresentationContext,
	RigAvatarPayload,
} from "../types";
import { renderAvatarImage, resolvePatientPortrait } from "./shared";

/**
 * rig — 自绘立绘（M2 实验）。与 live 的区别：live 是整图平移/旋转，rig 先把立绘分成
 * 「背景盘 + 主体」，再对主体施加位移场（头摆/呼吸/下颌），最后局部重绘眼皮与嘴。
 *
 * 仍未进生产链（`PRESENTATION_CHAIN` 还是 realistic → static），只在 `/presentation-lab` 陈列。
 */

/** 纯函数：身份 + 情绪 → 可渲染负载（动效参数在 build 里定死，render 只做插值）。 */
export function buildRigAvatarPayload(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
): RigAvatarPayload {
	const portrait = resolvePatientPortrait(patient, emotion);
	return {
		kind: "rig",
		src: portrait.src,
		alt: portrait.alt,
		profile: profileFor(emotion.emotion),
	};
}

function RigCanvas({ payload, ctx }: { payload: RigAvatarPayload; ctx: PresentationContext }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	// 每帧读最新的运行时上下文（speaking/envelope 由父组件 30Hz 更新）
	const latest = useRef(ctx);
	latest.current = ctx;
	// profile 是纯数据、跟着 payload 走；只用 src 做 effect 依赖，避免父组件重渲染时重建动画
	const profile = useRef(payload.profile);
	profile.current = payload.profile;

	useEffect(() => {
		const canvas = canvasRef.current;
		const rig = rigFor(payload.src);
		if (!canvas || !rig) return;
		const ctx2d = canvas.getContext("2d");
		if (!ctx2d) return;

		const img = new Image();
		img.src = payload.src;
		let layers: Layers | null = null;
		let raf = 0;
		let stopped = false;
		let env = 0;
		let mouth = 0.04;
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
			mouth = approach(mouth, mouthTarget(c.speaking, env), dt, 0.045, 0.09);
			layers ??= layersFor(img, rig, payload.src);
			renderFrame(
				ctx2d,
				layers,
				rig,
				{
					sway: swayAt(t),
					nod: nodAt(t, env, 0.8),
					breath: breathAt(t, profile.current.breathSeconds),
					blink: blinkAt(t, profile.current.blinkSeconds),
					jaw: mouth,
					mouth,
				},
				profile.current,
			);
		};

		const onLoad = () => {
			if (stopped) return;
			raf = requestAnimationFrame(draw);
		};
		if (img.complete) onLoad();
		else img.addEventListener("load", onLoad, { once: true });

		return () => {
			stopped = true;
			cancelAnimationFrame(raf);
			observer.disconnect();
			img.removeEventListener("load", onLoad);
		};
	}, [payload.src]);

	return (
		<div
			data-rig-avatar
			data-speaking={ctx.speaking ? "true" : "false"}
			className={ctx.className}
			style={{
				width: ctx.fill ? "100%" : ctx.size,
				aspectRatio: "1 / 1",
				position: "relative",
				overflow: "hidden",
				borderRadius: ctx.rounded === "full" ? "999px" : "1rem",
				boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
				background: "var(--mantine-color-default-hover)",
			}}
		>
			<canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
		</div>
	);
}

export const rigAvatarPresenter: PatientPresenter = {
	kind: "rig",
	build(patient, emotion) {
		return buildRigAvatarPayload(patient, emotion);
	},
	render(payload, ctx) {
		if (payload.kind !== "rig") return null;
		// 没有 rig 的立绘（病例自传情绪立绘、未标定的新图）退回静态图：引擎不做运行期猜测。
		if (ctx.reducedMotion || !rigFor(payload.src)) return renderAvatarImage(payload, ctx);
		return <RigCanvas payload={payload} ctx={ctx} />;
	},
};
