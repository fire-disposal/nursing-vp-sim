import { useCallback, useEffect, useState } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/** 系统减弱动态偏好（`prefers-reduced-motion: reduce`）。 */
export function useReducedMotion(): boolean {
	return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * 演示页的浅/深色判断。
 *
 * 人物配色是固定的暖色（`palette`），在深色主题下需要把"纸面"压暗、把文字交给
 * Mantine 变量，否则白底卡会刺眼。这里只算一个布尔值，具体色值仍走 CSS 变量。
 */
export function usePhoneSurface(): { dark: boolean } {
	const scheme = useComputedColorScheme("light");
	return { dark: scheme === "dark" };
}

/**
 * 实时"音量包络"近似值。
 *
 * 演示页不接 AnalyserNode（播放器与识别不在同一台音频图上），但口型需要动起来。
 * 所以这里在**说话期间**用一条低频正弦给出 0.25–0.85 的呼吸式数值——它驱动的是
 * 口型幅度而不是任何业务状态，不声称是真实音频包络。`reducedMotion` 时恒为 0。
 */
export function useSpeakingLevel(active: boolean, reducedMotion: boolean): number {
	const [level, setLevel] = useState(0);
	useEffect(() => {
		if (!active || reducedMotion) {
			setLevel(0);
			return;
		}
		let raf = 0;
		const started = performance.now();
		const tick = () => {
			const t = (performance.now() - started) / 1000;
			setLevel(0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 9.4)) + 0.1 * Math.sin(t * 23.1));
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [active, reducedMotion]);
	return level;
}

/** `navigator.vibrate` 之类的能力探测集中在 hooks 里，组件不直接摸 navigator。 */
export function useHaptics() {
	return useCallback((pattern: number | number[] = 12) => {
		try {
			navigator.vibrate?.(pattern);
		} catch {
			/* 不支持就算了 */
		}
	}, []);
}
