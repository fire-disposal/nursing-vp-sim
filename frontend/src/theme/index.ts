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
 *
 * 暗色模式对齐迁移前观感（冷调 slate 系）：
 * - 背景 #111827（slate-900）、hover #1e293b、更深 #0f172a 递进
 * - 边框半透明白（rgba(255,255,255,.1)）而非纯灰线
 * - 主色暗色提亮（dark 用 5 号 ≈ 旧 #14b8a6 观感），autoContrast 保证文字对比
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
	// 亮色用 7 号（而非 6 号）：6 号 #2c9a82 作白底文字或白字按钮底色只有 ≈3.5:1，
	// 低于 WCAG AA 正文 4.5:1（审计 UI-A11Y-1 实测）；7 号 #247f6b ≈4.9:1，两种用法都合规。
	// 暗色保持 5 号（在深底上更亮），autoContrast 继续负责 filled 变体的黑白文字。
	primaryShade: { light: 7, dark: 5 },
	// 亮/暗主色自动适配文字对比（filled 变体自动黑白文字）
	autoContrast: true,

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
		// 冷调 slate 暗色系（对齐迁移前 .dark 配色）
		dark: [
			"#e2e8f0", // 0 主文本（slate-200）
			"#cbd5e1", // 1
			"#94a3b8", // 2 dimmed（slate-400，对齐旧 muted-foreground）
			"#64748b", // 3
			"#475569", // 4 边框基线
			"#334155", // 5 secondary/muted（slate-700）
			"#1e293b", // 6 hover（slate-800）
			"#111827", // 7 body 背景（slate-900）
			"#0f172a", // 8 更深（slate-950）
			"#0b1120", // 9
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

/**
 * 语义变量覆盖（Mantine 官方的浅/深色通路，替代逐文件改色）。
 *
 * `--mantine-color-dimmed` 默认浅色取 gray-6 `#868e96`：白底实测 3.32:1，低于 AA 正文 4.5:1，
 * 而它承载的正是页头副标题、表格时间/时长、导航项描述等 11–14px 文本 —— 审计 UI-A11Y-1
 * 在 `/admin/records` 实测 365 处、`/admin/users` 298 处命中。浅色改取 gray-7 `#495057`（7.0:1）；
 * 深色维持 slate-400 观感（`dark-2` 在 `#111827` 上 ≈7.3:1），不为了修浅色而压暗深色。
 */
export const cssVariablesResolver = () => ({
	variables: {},
	light: {
		"--mantine-color-dimmed": "var(--mantine-color-gray-7)",
	},
	dark: {
		"--mantine-color-dimmed": "var(--mantine-color-dark-2)",
	},
});
