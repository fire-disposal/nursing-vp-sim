import { useEffect, useRef } from "react";
import { Box, Text } from "@mantine/core";
import type { WaveRing } from "./waveRing";

export interface AcousticWaveformProps {
	title: string;
	data: WaveRing;
	color: string;
	/** 固定显示最近多少秒；旧样本从左侧滚出。 */
	seconds: number;
	/** 数据变更计数：环形缓冲原地变化时触发重绘。 */
	version: number;
}

/** 轻量时域波形：固定时间窗 + 像素级 min/max，不做整段历史缩放。 */
export default function AcousticWaveform({ title, data, color, seconds, version }: AcousticWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ratio = window.devicePixelRatio || 1;
		const width = Math.max(1, canvas.clientWidth);
		const height = Math.max(1, canvas.clientHeight);
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(ratio, ratio);
		ctx.clearRect(0, 0, width, height);
		ctx.strokeStyle = getComputedStyle(canvas).color;
		ctx.lineWidth = 1;
		ctx.globalAlpha = 0.2;
		ctx.beginPath();
		ctx.moveTo(0, height / 2);
		ctx.lineTo(width, height / 2);
		ctx.stroke();
		ctx.globalAlpha = 1;

		const windowSamples = Math.max(1, Math.floor(seconds * 16_000));
		const samplesPerPixel = windowSamples / width;
		ctx.beginPath();
		for (let x = 0; x < width; x += 1) {
			const ageStart = windowSamples - (x + 1) * samplesPerPixel;
			const ageEnd = windowSamples - x * samplesPerPixel;
			const from = Math.max(0, Math.floor(ageStart));
			const to = Math.min(data.length, Math.ceil(ageEnd));
			if (to <= from) continue;
			let min = 1;
			let max = -1;
			for (let age = from; age < to; age += 1) {
				const value = data.get(age);
				if (value < min) min = value;
				if (value > max) max = value;
			}
			if (max < min) continue;
			const y1 = height / 2 - max * height * 0.46;
			const y2 = height / 2 - min * height * 0.46;
			ctx.moveTo(x + 0.5, y1);
			ctx.lineTo(x + 0.5, y2);
		}
		ctx.stroke();
	}, [data, seconds, version]);

	return (
		<Box className="acoustic-waveform">
			<Text size="xs" c="dimmed">{title}</Text>
			<canvas ref={canvasRef} style={{ color }} role="img" aria-label={title} />
		</Box>
	);
}
