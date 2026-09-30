/**
 * 版式刻度 —— 宽度/高度断点与壳尺寸的**唯一来源**。
 *
 * 痛点（2026-09-30 审计）：同一件事的阈值散落在 7 处（640/760/768/992/1024/1081/1200 +
 * 高度 500），改一处不知道另一处存在，于是出现"某个宽度下侧栏与底部 Tab 同时消失"这类
 * 无人能解释的形态。这里给每个阈值一个**名字与用途**，任何新代码不得再写字面量。
 *
 * 已知边界：CSS 媒体查询里用不了这个模块（`@media` 不认 `var()`），所以 `scenario.css`
 * 仍保留字面量，其值必须与本文件的对应项一致（文件内已标注指向哪个常量）。
 */

/** 宽度断点（px）。名字 = 用途，不是设备名。 */
export const WIDTH = {
	/** 记录详情：桌面双栏 / 手机单栏。 */
	recordSplit: 640,
	/** 情境控制台的窄屏形态（抽屉、页头控件形状）。 */
	scenarioNarrow: 760,
	/** 壳：手机导航形态（底部 Tab / 抽屉）与桌面侧栏的分界。 */
	phoneShell: 768,
	/** 数据表降级为卡片列表。比 phoneShell 宽：平板仍宜用卡片读表。 */
	tableCompact: 992,
	/** 登录页插画（窄于此只留表单，避免插画挤掉表单可读宽度）。 */
	loginIllustration: 1024,
	/** 情境控制台的宽屏布局（多列面板）。 */
	scenarioWide: 1081,
	/** 训练工作区：右侧栏常驻（低于此宽度改用竖屏抽屉）。 */
	rail: 1200,
} as const;

/** 高度断点（px）。 */
export const HEIGHT = {
	/** 横屏手机等短视口：压缩顶栏、强制折叠侧栏（垂直空间比横向空间更贵）。 */
	shortViewport: 500,
} as const;

/** 壳尺寸（px）——AppShell 头/侧栏/底栏与内容容器。 */
export const SHELL = {
	headerHeight: 56,
	/** 短视口下的顶栏高度。 */
	headerHeightShort: 48,
	sidebarWidth: 260,
	/** 底部 Tab 栏高度（安全区另加）。 */
	footerHeight: 56,
	/** 内容容器上限：超宽屏不贴边（表格仍可横向滚动）。 */
	contentMaxWidth: 1600,
} as const;

/**
 * 媒体查询串写法（各处自己插值，别为此再造一层包装）：
 * ``useMediaQuery(`(min-width: ${WIDTH.phoneShell}px)`)``
 */
