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
			grid: isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-gray-2)",
			axisTick: isDark ? "var(--mantine-color-dark-2)" : "var(--mantine-color-gray-6)",
			tooltipBg: isDark ? "var(--mantine-color-dark-6)" : "var(--mantine-color-body)",
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
			sessions: isDark ? "var(--mantine-color-blue-4)" : "var(--mantine-color-blue-6)",
			minutes: isDark ? "var(--mantine-color-yellow-5)" : "var(--mantine-color-yellow-6)",
			score: isDark ? "var(--mantine-color-green-4)" : "var(--mantine-color-green-6)",
		};
	}, [scheme]);
}
