import { useCallback } from "react";
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
