import { useComputedColorScheme } from "@mantine/core";
import { useMemo } from "react";

export interface ChartColors {
	grid: string;
	axisTick: string;
	tooltipBg: string;
	tooltipBorder: string;
}

export function useChartTheme() {
	const scheme = useComputedColorScheme("light");

	return useMemo((): ChartColors => {
		const isDark = scheme === "dark";
		return {
			grid: isDark ? "var(--mantine-color-dark-4)" : "#f0f0f0",
			axisTick: isDark ? "var(--mantine-color-dark-2)" : "#9ca3af",
			tooltipBg: isDark ? "var(--mantine-color-dark-6)" : "#ffffff",
			tooltipBorder: isDark
				? "var(--mantine-color-dark-4)"
				: "var(--mantine-color-gray-3)",
		};
	}, [scheme]);
}

export function useBarColors() {
	const scheme = useComputedColorScheme("light");
	return useMemo(() => {
		const isDark = scheme === "dark";
		return {
			sessions: isDark ? "#60a5fa" : "#2563eb",
			minutes: isDark ? "#fbbf24" : "#f59e0b",
			score: isDark ? "#4ade80" : "#22c55e",
		};
	}, [scheme]);
}
