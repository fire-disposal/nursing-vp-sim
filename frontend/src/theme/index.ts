import { createTheme } from "@mantine/core";

const FONT_SANS =
	'"Geist Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/**
 * 护理临床主题（业务驱动，非通用 UI 范式）。
 *
 * 设计语言：
 * - 主色为去饱和的临床青绿（护理/医疗场景的可信感，区别于泛化蓝）。
 * - 数字一律用 tabular-nums（分数/时长/排名对齐）。
 * - 交互元素圆角柔和（md），克制、一致，无渐变滥用。
 * - 组件默认值收敛，页面专注业务内容而非装饰。
 */
export const theme = createTheme({
	fontFamily: FONT_SANS,
	fontFamilyMonospace:
		'"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
	cursorType: "pointer",
	focusRing: "auto",
	// Mantine 内置过渡尊重系统减弱动态偏好
	respectReducedMotion: true,
	defaultRadius: "sm",
	primaryColor: "brand",
	primaryShade: { light: 6, dark: 7 },

	// 临床青绿 10 阶色板（去饱和、低纯度，适配医院场景的冷静感）
	colors: {
		brand: [
			"#eefaf6",
			"#d8f3ea",
			"#b2e6d6",
			"#86d5bf",
			"#5dc2a8",
			"#3cb094",
			"#2c9a82",
			"#247f6b",
			"#1e6757",
			"#195347",
		],
	},

	headings: {
		fontFamily: FONT_SANS,
		fontWeight: "700",
		textWrap: "balance",
		sizes: {
			h1: { fontSize: "1.75rem", lineHeight: "1.25" },
			h2: { fontSize: "1.375rem", lineHeight: "1.3" },
			h3: { fontSize: "1.125rem", lineHeight: "1.4" },
			h4: { fontSize: "1rem", lineHeight: "1.45" },
			h5: { fontSize: "0.9375rem", lineHeight: "1.5" },
			h6: { fontSize: "0.875rem", lineHeight: "1.5" },
		},
	},

	components: {
		// 交互控件圆角收敛为 md：临床界面友好而非锋利
		Button: { defaultProps: { radius: "md" } },
		ActionIcon: { defaultProps: { radius: "md" } },
		Badge: { defaultProps: { radius: "sm" } },
		Modal: { defaultProps: { radius: "md" } },
		Notification: { defaultProps: { radius: "md" } },
		Tooltip: { defaultProps: { radius: "sm" } },
		Card: { defaultProps: { withBorder: true, radius: "md" } },
		Paper: { defaultProps: { radius: "md" } },
		// 数据表格统一密度：紧凑、可扫读
		Table: {
			defaultProps: {
				verticalSpacing: "sm",
				horizontalSpacing: "sm",
				fz: "sm",
			},
		},
	},
});
