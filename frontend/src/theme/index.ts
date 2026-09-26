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
		// ── 两档圆角（2026-09-26 显式化）──
		// 容器/按钮层 = md(8px)；控件/小件层 = sm(4px)。此前只有容器层显式声明，
		// 控件层实际靠 defaultRadius:"sm" 隐式继承，读代码看不出规则（审计 UI-DS-3）。
		// 规则：新增组件若不写 radius，默认落在「控件层」= sm；属于容器层的必须在此声明。
		Button: { defaultProps: { radius: "md" } },
		ActionIcon: { defaultProps: { radius: "md" } },
		Modal: { defaultProps: { radius: "md" } },
		Notification: { defaultProps: { radius: "md" } },
		Card: { defaultProps: { withBorder: true, radius: "md" } },
		Paper: { defaultProps: { radius: "md" } },
		SegmentedControl: { defaultProps: { radius: "sm" } },
		Chip: { defaultProps: { radius: "sm" } },
		Tooltip: { defaultProps: { radius: "sm" } },
		// 徽章：字号下限 12px（原实现随 size 落到 9–11px，审计 UI-DS-3/A11Y 均有命中）。
		// size 仍控制高度与内边距，这里只锁字号。
		Badge: {
			defaultProps: { radius: "sm" },
			styles: { root: { fontSize: "var(--mantine-font-size-xs)" } },
		},
		// 数据表格统一密度 + 统一灰色表头（唯一来源：各页不要再自己写 thead 背景，
		// 否则会出现"有些页白表头、有些页灰表头"）
		Table: {
			defaultProps: {
				verticalSpacing: "sm",
				horizontalSpacing: "sm",
				fz: "sm",
			},
			styles: {
				th: {
					background: "var(--mantine-color-gray-1)",
					color: "var(--mantine-color-dimmed)",
					textTransform: "uppercase",
					fontSize: "var(--mantine-font-size-xs)",
					fontWeight: 700,
					letterSpacing: "0.06em",
				},
			},
		},
	},

	// 供代码/评审引用的比例尺（非运行时开关，避免散落魔法数字）。
	other: {
		uiScale: {
			radius: { container: "md", control: "sm" },
			icon: { sm: 14, md: 16, lg: 18 },
			font: { body: "var(--mantine-font-size-sm)", marker: 11, floor: 12 },
			chartAxisTick: 11,
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
		// `variant="light"` 徽章/按钮的浅色配色默认是「color-1 底 + color-9 字」，
		// 实测多数色系只有 2.7–4.9:1（yellow 2.69、orange 3.62、green 3.81、teal 4.33），
		// 在 11px 字号下低于 AA。逐色系改为「color-0 底 + 按需压暗的 color-9 字」，
		// 全部 ≥5.0:1（色值由运行时 token 按比例压暗求得，非手调）：
		//   yellow  #e67700 → #a65600 (5.02) · green  #2b8a3e → #267937 (5.05)
		//   orange  #d9480f → #bb3e0d (5.08) · teal   #087f5b → #087756 (5.18)
		//   其余色系（gray/blue/red/grape/violet/indigo/brand）仅换浅底即 ≥5.0（4.93→5.48 等）。
		"--mantine-color-gray-light": "var(--mantine-color-gray-0)",
		"--mantine-color-blue-light": "var(--mantine-color-blue-0)",
		"--mantine-color-red-light": "var(--mantine-color-red-0)",
		"--mantine-color-yellow-light": "var(--mantine-color-yellow-0)",
		"--mantine-color-green-light": "var(--mantine-color-green-0)",
		"--mantine-color-orange-light": "var(--mantine-color-orange-0)",
		"--mantine-color-teal-light": "var(--mantine-color-teal-0)",
		"--mantine-color-grape-light": "var(--mantine-color-grape-0)",
		"--mantine-color-violet-light": "var(--mantine-color-violet-0)",
		"--mantine-color-indigo-light": "var(--mantine-color-indigo-0)",
		"--mantine-color-brand-light": "var(--mantine-color-brand-0)",
		"--mantine-color-yellow-light-color": "#a65600",
		"--mantine-color-green-light-color": "#267937",
		"--mantine-color-orange-light-color": "#bb3e0d",
		"--mantine-color-teal-light-color": "#087756",
		// `c="blue"` 这类**颜色名文字**映射到 `--mantine-color-{名}-text`，浅色下默认取鲜艳的
		// -6/-7 档：yellow 2.13、green 2.75、orange 3.04、teal 3.12、red 3.84（白底）—— 远低于 AA。
		// 统一改取 -9（个别再压暗到 ≥5.0），这样全站 `c="色名"` 文字一次到位，无需改调用点。
		"--mantine-color-gray-text": "var(--mantine-color-gray-9)",
		"--mantine-color-blue-text": "var(--mantine-color-blue-9)",
		"--mantine-color-red-text": "var(--mantine-color-red-9)",
		"--mantine-color-teal-text": "var(--mantine-color-teal-9)",
		"--mantine-color-grape-text": "var(--mantine-color-grape-9)",
		"--mantine-color-violet-text": "var(--mantine-color-violet-9)",
		"--mantine-color-indigo-text": "var(--mantine-color-indigo-9)",
		"--mantine-color-brand-text": "var(--mantine-color-brand-9)",
		"--mantine-color-yellow-text": "#aa5800",
		"--mantine-color-green-text": "#287f39",
		"--mantine-color-orange-text": "#c3410e",
	},
	dark: {
		"--mantine-color-dimmed": "var(--mantine-color-dark-2)",
	},
});
