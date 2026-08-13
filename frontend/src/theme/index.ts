import { createTheme, type MantineThemeOverride } from "@mantine/core";

/** Mantine 内置色名，作为品牌 primaryColor。 */
export type BrandColor = "teal" | "blue" | "green" | "gray";

/**
 * 品牌色板 — 4 套医疗风格配色。
 *
 * 映射到 Mantine 内置色，获得完整 10 阶色阶，保证 hover / light / dark
 * 状态一致。图表色由 recharts 直接消费。
 */
export interface BrandPalette {
	id: string;
	label: string;
	description: string;
	/** Mantine 色名，作为 primaryColor */
	primaryColor: BrandColor;
	/** recharts 图表色板（5 色） */
	chart: [string, string, string, string, string];
}

export const BRAND_PALETTES: BrandPalette[] = [
	{
		id: "teal",
		label: "青碧",
		description: "清新医疗风格，默认配色",
		primaryColor: "teal",
		chart: ["#0f766e", "#0284c7", "#059669", "#ea580c", "#dc2626"],
	},
	{
		id: "blue",
		label: "海蓝",
		description: "经典临床蓝色，沉稳可信",
		primaryColor: "blue",
		chart: ["#2563eb", "#0891b2", "#16a34a", "#ea580c", "#dc2626"],
	},
	{
		id: "green",
		label: "松绿",
		description: "自然舒缓，护眼柔和",
		primaryColor: "green",
		chart: ["#15803d", "#0e7490", "#16a34a", "#ca8a04", "#dc2626"],
	},
	{
		id: "slate",
		label: "岩灰",
		description: "严谨学术风，沉稳专业",
		primaryColor: "gray",
		chart: ["#475569", "#2563eb", "#059669", "#d97706", "#ef4444"],
	},
];

export const DEFAULT_BRAND = "teal";

export function getBrandPalette(id: string): BrandPalette {
	return BRAND_PALETTES.find((p) => p.id === id) ?? BRAND_PALETTES[0];
}

const FONT_SANS =
	'"Geist Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const FONT_MONO =
	'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** 依据当前品牌色生成 Mantine 主题。brand 变更时由调用方 memo。 */
export function createAppTheme(brand: string): MantineThemeOverride {
	return createTheme({
		primaryColor: getBrandPalette(brand).primaryColor,
		fontFamily: FONT_SANS,
		fontFamilyMonospace: FONT_MONO,
		defaultRadius: "md",
		cursorType: "pointer",
		headings: { fontFamily: FONT_SANS, fontWeight: "600" },
	});
}
