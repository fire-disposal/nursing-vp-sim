import { useTheme } from "next-themes";
import { useMemo } from "react";

export interface ChartColors {
	grid: string;
	axisTick: string;
	tooltipBg: string;
	tooltipBorder: string;
}

export function useChartTheme() {
	const { resolvedTheme } = useTheme();

	return useMemo((): ChartColors => {
		const isDark = resolvedTheme === "dark";
		return {
			grid: isDark ? "var(--border)" : "#f0f0f0",
			axisTick: isDark ? "var(--muted-foreground)" : "#9ca3af",
			tooltipBg: isDark ? "var(--card)" : "var(--background)",
			tooltipBorder: isDark ? "var(--border)" : "var(--border)",
		};
	}, [resolvedTheme]);
}

export function useBarColors() {
	const { resolvedTheme } = useTheme();
	return useMemo(() => {
		const isDark = resolvedTheme === "dark";
		return {
			sessions: isDark ? "#60a5fa" : "#2563eb",
			minutes: isDark ? "#fbbf24" : "#f59e0b",
			score: isDark ? "#4ade80" : "#22c55e",
		};
	}, [resolvedTheme]);
}
