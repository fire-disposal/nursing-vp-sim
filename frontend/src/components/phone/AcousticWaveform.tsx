import { useEffect, useRef } from "react";
import { Box, Text } from "@mantine/core";

export interface AcousticWaveformProps {
	title: string;
	data: number[];
	color: string;
	/** 显示最近多少秒；长窗口自动做像素级 min/max 降采样。 */
	seconds: number;
	/** 数据变更计数：数组原地增长时也触发重绘。 */
	version: number;
}

/** 轻量时域波形：数据来自真实 PCM，不用模拟动画。 */
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
		const windowStart = data.length - windowSamples;
		const samplesPerPixel = windowSamples / width;
		ctx.beginPath();
		for (let x = 0; x < width; x += 1) {
			const fromTime = windowStart + x * samplesPerPixel;
			const toTime = windowStart + (x + 1) * samplesPerPixel;
			const from = Math.max(0, Math.ceil(fromTime));
			const to = Math.min(data.length, Math.floor(toTime));
			if (to <= from) continue;
			let min = 1;
			let max = -1;
			for (let i = from; i < to; i += 1) {
				const value = data[i] ?? 0;
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
