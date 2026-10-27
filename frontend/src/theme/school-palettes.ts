/**
 * 院校主题色板 —— 「可选」的闭集，不是任意取色器。
 *
 * 为什么是固定调色板而不是任意 hex：主题色会被当成品牌主色用在填充按钮/链接上
 * （`primaryShade` 7 + 白字），任意 hex 会把对比度打到 WCAG AA 以下且无法在暗色下校正。
 * 这 8 组取自 Mantine 默认色阶（每档都按可读性调过），键名存进 `schools.theme_color`，
 * 空 = 沿用平台默认品牌色。
 *
 * 只影响观感，不参与隔离 —— 隔离由 `core/tenant.py` 决定。
 */

export interface SchoolPalette {
	key: string;
	label: string;
	/** 0（最浅）→ 9（最深）；主色取 7 号（与平台默认品牌的 primaryShade 一致） */
	shades: readonly [string, string, string, string, string, string, string, string, string, string];
}

export const SCHOOL_PALETTES: readonly SchoolPalette[] = [
	{
		key: "teal",
		label: "青绿",
		shades: ["#e6fcf5", "#c3fae8", "#96f2d7", "#63e6be", "#38d9a9", "#20c997", "#12b886", "#0ca678", "#099268", "#087f5b"],
	},
	{
		key: "blue",
		label: "湖蓝",
		shades: ["#e7f5ff", "#d0ebff", "#a5d8ff", "#74c0fc", "#4dabf7", "#339af0", "#228be6", "#1c7ed6", "#1971c2", "#1864ab"],
	},
	{
		key: "indigo",
		label: "靛蓝",
		shades: ["#edf2ff", "#dbe4ff", "#bac8ff", "#91a7ff", "#748ffc", "#5c7cfa", "#4c6ef5", "#4263eb", "#3b5bdb", "#364fc7"],
	},
	{
		key: "violet",
		label: "紫罗兰",
		shades: ["#f3f0ff", "#e5dbff", "#d0bfff", "#b197fc", "#9775fa", "#845ef7", "#7950f2", "#7048e8", "#6741d9", "#5f3dc4"],
	},
	{
		key: "grape",
		label: "洋红",
		shades: ["#f8f0fc", "#f3d9fa", "#eebefa", "#e599f7", "#da77f2", "#cc5de8", "#be4bdb", "#ae3ec9", "#9c36b5", "#862e9c"],
	},
	{
		key: "green",
		label: "松绿",
		shades: ["#ebfbee", "#d3f9d8", "#b2f2bb", "#8ce99a", "#69db7c", "#51cf66", "#40c057", "#37b24d", "#2f9e44", "#2b8a3e"],
	},
	{
		key: "orange",
		label: "赭橙",
		shades: ["#fff4e6", "#ffe8cc", "#ffd8a8", "#ffc078", "#ffa94d", "#ff922b", "#fd7e14", "#f76707", "#e8590c", "#d9480f"],
	},
	{
		key: "red",
		label: "胭红",
		shades: ["#fff5f5", "#ffe3e3", "#ffc9c9", "#ffa8a8", "#ff8787", "#ff6b6b", "#fa5252", "#f03e3e", "#e03131", "#c92a2a"],
	},
] as const;

export function schoolPalette(key: string | null | undefined): SchoolPalette | undefined {
	if (!key) return undefined;
	return SCHOOL_PALETTES.find((palette) => palette.key === key);
}
