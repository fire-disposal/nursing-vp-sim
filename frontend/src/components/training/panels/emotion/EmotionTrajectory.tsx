import { useEffect, useRef, useState } from "react";

interface TrajectoryPoint {
	trust: number;
	comfort: number;
	intent: string;
	timestamp: string;
}

interface EmotionTrajectoryProps {
	history?: TrajectoryPoint[];
	current: { trust: number; comfort: number };
}

const PADDING = 8;
const DOT_R = 4;
const GRID_COLOR = "rgba(128,128,128,0.12)";
const AXIS_COLOR = "rgba(128,128,128,0.25)";
const AXIS_FONT = "9px sans-serif";

const QUADRANT_LABELS: Record<string, { x: number; y: number; text: string }> =
	{
		ll: { x: 0.15, y: 0.92, text: "退缩" },
		lr: { x: 0.72, y: 0.92, text: "紧张配合" },
		ul: { x: 0.15, y: 0.15, text: "防御" },
		ur: { x: 0.72, y: 0.15, text: "开放" },
	};

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
	ctx.strokeStyle = GRID_COLOR;
	ctx.lineWidth = 0.5;
	for (let i = 1; i < 5; i++) {
		const x = PADDING + ((w - PADDING * 2) * i) / 5;
		ctx.beginPath();
		ctx.moveTo(x, PADDING);
		ctx.lineTo(x, h - PADDING);
		ctx.stroke();
		const y = PADDING + ((h - PADDING * 2) * i) / 5;
		ctx.beginPath();
		ctx.moveTo(PADDING, y);
		ctx.lineTo(w - PADDING, y);
		ctx.stroke();
	}
}

function drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number) {
	ctx.strokeStyle = AXIS_COLOR;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(PADDING, h - PADDING);
	ctx.lineTo(w - PADDING, h - PADDING);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(PADDING, PADDING);
	ctx.lineTo(PADDING, h - PADDING);
	ctx.stroke();

	ctx.fillStyle = AXIS_COLOR;
	ctx.font = AXIS_FONT;
	ctx.textAlign = "center";
	ctx.fillText("信赖→", w / 2, h - 2);

	ctx.save();
	ctx.translate(6, h / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText("舒适→", 0, 0);
	ctx.restore();
}

function drawQuadrantLabels(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
) {
	ctx.fillStyle = "rgba(128,128,128,0.18)";
	ctx.font = "11px sans-serif";
	for (const { x, y, text } of Object.values(QUADRANT_LABELS)) {
		ctx.fillText(
			text,
			PADDING + (w - PADDING * 2) * x,
			PADDING + (h - PADDING * 2) * y,
		);
	}
}

function toCanvas(pct: number, max: number, pad: number): number {
	return pad + (max - pad * 2) * (pct / 100);
}

function drawPoint(
	ctx: CanvasRenderingContext2D,
	trust: number,
	comfort: number,
	w: number,
	h: number,
	alpha: number,
	r: number,
	glow: boolean,
) {
	const x = toCanvas(trust, w, PADDING);
	const y = toCanvas(100 - comfort, h, PADDING);

	if (glow) {
		ctx.save();
		ctx.shadowColor = `rgba(59,130,246,${alpha})`;
		ctx.shadowBlur = 8;
	}

	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fillStyle = `rgba(59,130,246,${alpha})`;
	ctx.fill();

	if (glow) {
		ctx.restore();
		const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 1000);
		ctx.beginPath();
		ctx.arc(x, y, r + 4, 0, Math.PI * 2);
		ctx.strokeStyle = `rgba(59,130,246,${0.15 * pulse})`;
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}
}

export function EmotionTrajectory({
	history,
	current,
}: EmotionTrajectoryProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [dpr, setDpr] = useState(1);

	useEffect(() => {
		setDpr(window.devicePixelRatio || 1);
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const w = rect.width * dpr;
		const h = rect.height * dpr;
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, w, h);

		drawGrid(ctx, w, h);
		drawAxes(ctx, w, h);
		drawQuadrantLabels(ctx, w, h);

		if (history && history.length > 0) {
			for (let i = 0; i < history.length; i++) {
				const alpha = 0.08 + ((i + 1) / history.length) * 0.35;
				const r = 2 + (i / history.length) * 1.5;
				drawPoint(
					ctx,
					history[i].trust,
					history[i].comfort,
					w,
					h,
					alpha,
					r,
					false,
				);
			}
		}

		drawPoint(ctx, current.trust, current.comfort, w, h, 1, DOT_R, true);

		let animId: number;
		const animate = () => {
			ctx.clearRect(0, 0, w, h);
			drawGrid(ctx, w, h);
			drawAxes(ctx, w, h);
			drawQuadrantLabels(ctx, w, h);
			if (history && history.length > 0) {
				for (let i = 0; i < history.length; i++) {
					const alpha = 0.08 + ((i + 1) / history.length) * 0.35;
					const r = 2 + (i / history.length) * 1.5;
					drawPoint(
						ctx,
						history[i].trust,
						history[i].comfort,
						w,
						h,
						alpha,
						r,
						false,
					);
				}
			}
			drawPoint(ctx, current.trust, current.comfort, w, h, 1, DOT_R, true);
			animId = requestAnimationFrame(animate);
		};
		animId = requestAnimationFrame(animate);

		return () => cancelAnimationFrame(animId);
	}, [history, current, dpr]);

	return (
		<div
			className="rounded-lg border bg-muted/20 overflow-hidden"
			style={{ aspectRatio: "1" }}
		>
			<canvas
				ref={canvasRef}
				className="w-full h-full"
				style={{ width: "100%", height: "100%" }}
			/>
		</div>
	);
}
