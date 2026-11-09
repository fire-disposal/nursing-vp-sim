/**
 * 临床判断 V2 —— 夜间急诊的**视觉系统**（唯一色彩/材质来源）。
 *
 * 美术方向：床旁调查现场。深青底（夜间病区）、暖琥珀只给"新证据"与关键动作、
 * 冷白文字。所有颜色在这里以 CSS 变量形式落地，组件只用变量，不写色值 ——
 * 这样"夜班"是一个可替换的主题，而不是散落在 8 个文件里的十六进制。
 *
 * 静态可读性优先：任何状态（确认/待求证/完成/失败）都必须在不看动画的情况下
 * 靠形状、描边、标签区分；颜色只是加强。
 *
 * 层级词汇（这是本工作台的"图形语法"，不是一堆卡片）：
 * - `cr-stage`    主舞台的底（患者所在的空间）
 * - `cr-plate`    抬起的一层（对话记分板、操作坞）
 * - `cr-chip`     证据链上的一个线索（左缘脊线 = 获取途径的颜色，右上角 = 状态印记）
 * - `cr-bay`      操作坞里的一个动作位（虚线 = 待求证/未获取，实线 = 可执行）
 * - `cr-gauge`    进度刻度（判断线索），只有一条，位于顶栏
 */
import type { CSSProperties } from "react";

/** 证据途径 → 该途径在证据链上的脊线颜色（静态区分，不依赖图例也能读）。 */
export const EVIDENCE_ACCENT: Record<string, string> = {
	vital_sign: "219, 91, 74", // 生命体征：暖红（读数）
	exam: "232, 178, 92", // 床旁体征：琥珀（触诊/听诊）
	lab: "122, 186, 210", // 检验：冷青蓝（报告）
	observation: "146, 176, 168", // 观察：灰青（看见）
	history: "196, 178, 226", // 病史：淡紫（患者叙述）
};

/** 途径色的可直接用于文字/图标的形态（`rgb(...)`）。 */
export function evidenceToneColor(kind: string): string {
	return `rgb(${EVIDENCE_ACCENT[kind] ?? EVIDENCE_ACCENT.observation})`;
}

/** 自定义属性容器：CSS 变量不在 `CSSProperties` 的类型里，单独命名一次即可安全使用。 */
type ToneVars = CSSProperties & {
	"--accent": string;
	"--accent-soft": string;
	"--accent-line": string;
};

/** 让一个元素把途径色注入为 `--accent` 及淡染层，供子元素引用。 */
export function evidenceToneStyle(kind: string): ToneVars {
	const rgb = EVIDENCE_ACCENT[kind] ?? EVIDENCE_ACCENT.observation;
	return {
		"--accent": `rgb(${rgb})`,
		"--accent-soft": `rgba(${rgb}, 0.14)`,
		"--accent-line": `rgba(${rgb}, 0.42)`,
	};
}
